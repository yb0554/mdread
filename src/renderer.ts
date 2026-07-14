/**
 * Secure Markdown reader pipeline.
 * Markdown parsing runs in a dedicated Worker. The DOM is only updated after
 * main-thread sanitization and a latest-request check have both succeeded.
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import hljs from 'highlight.js/lib/common';
import { sanitizeAndTransformMarkdown, isSafeExternalUrl } from './content-transform';
import { getAppState, updateAppState } from './storage';
import type { AppError, DocumentPayload, DocumentRef } from './types';
import { toAppError } from './types';

const LARGE_HIGHLIGHT_THRESHOLD = 5 * 1024 * 1024;
const renderedCallbacks = new Set<() => void>();
const loadedCallbacks = new Set<(payload: DocumentPayload) => void>();

interface FileChangedEvent {
  sessionId: string;
  documentRef: DocumentRef;
}

interface WorkerRenderSuccess {
  kind: 'rendered';
  requestId: number;
  html: string;
  elapsedMs: number;
}

interface WorkerRenderFailure {
  kind: 'error';
  requestId: number;
  message: string;
}

interface RenderMetrics {
  parseDurationMs: number;
  deferredHighlight: boolean;
}

type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };
type IdleWindow = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

let latestRequestId = 0;
let activePayload: DocumentPayload | null = null;
let activeWatchSessionId: string | null = null;
let activeLoadRequestId: number | null = null;
let watchGeneration = 0;
let watchOperation: Promise<void> = Promise.resolve();
let watcherInitialized = false;
let activeParseWorker: Worker | null = null;
let rejectActiveParse: ((reason?: unknown) => void) | null = null;
let cancelDeferredHighlight: (() => void) | null = null;
let activeRenderMetrics: RenderMetrics = { parseDurationMs: 0, deferredHighlight: false };
const documentPaths = new Map<string, string>();

function createAbortError(): Error {
  const error = new Error('Markdown rendering cancelled');
  error.name = 'AbortError';
  return error;
}

function cancelPendingMarkdownParse(): void {
  activeParseWorker?.terminate();
  activeParseWorker = null;
  rejectActiveParse?.(createAbortError());
  rejectActiveParse = null;
}

function cancelDeferredHighlighting(): void {
  cancelDeferredHighlight?.();
  cancelDeferredHighlight = null;
}

function activeDocumentPath(payload: DocumentPayload): string {
  const ref = payload.documentRef;
  if (ref.documentId && documentPaths.has(ref.documentId)) {
    return documentPaths.get(ref.documentId)!;
  }
  if (ref.workspaceId && ref.relativePath) {
    const root = document.querySelector<HTMLElement>(`.tree-root[data-workspace-id="${CSS.escape(ref.workspaceId)}"]`);
    const rootPath = root?.dataset.workspacePath;
    if (rootPath) {
      const separator = rootPath.includes('\\') ? '\\' : '/';
      return `${rootPath}${separator}${ref.relativePath.replace(/\//g, separator)}`;
    }
  }
  const selected = document.querySelector<HTMLElement>('.tree-node.file.selected');
  return selected?.dataset.absolutePath || payload.name;
}

async function parseMarkdownInWorker(content: string, requestId: number, enableHighlight: boolean): Promise<{ html: string; elapsedMs: number }> {
  cancelPendingMarkdownParse();
  const worker = new Worker(new URL('./markdown-worker.ts', import.meta.url), { type: 'module' });
  activeParseWorker = worker;

  return new Promise((resolve, reject) => {
    const finish = (): void => {
      worker.terminate();
      if (activeParseWorker === worker) activeParseWorker = null;
      if (rejectActiveParse === reject) rejectActiveParse = null;
    };
    rejectActiveParse = reject;
    worker.onmessage = (event: MessageEvent<WorkerRenderSuccess | WorkerRenderFailure>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      finish();
      if (message.kind === 'error') {
        reject(new Error(message.message));
        return;
      }
      resolve({ html: message.html, elapsedMs: message.elapsedMs });
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'Markdown Worker 无法启动'));
    };
    worker.postMessage({ kind: 'render', requestId, content, enableHighlight });
  });
}

function scheduleIdle(callback: (deadline: IdleDeadlineLike) => void): () => void {
  const idleWindow = window as IdleWindow;
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 350 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 16 }), 0);
  return () => window.clearTimeout(handle);
}

function highlightCodeBlock(code: HTMLElement): void {
  const language = [...code.classList]
    .find((name) => name.startsWith('language-'))
    ?.slice('language-'.length);
  const source = code.textContent || '';
  const highlighted = language && hljs.getLanguage(language)
    ? hljs.highlight(source, { language }).value
    : hljs.highlightAuto(source).value;
  code.innerHTML = highlighted;
  code.dataset.highlighted = 'true';
}

function scheduleDeferredCodeHighlighting(content: HTMLElement, requestId: number): void {
  cancelDeferredHighlighting();
  const blocks = [...content.querySelectorAll<HTMLElement>('pre > code')];
  if (blocks.length === 0) return;

  let cancelled = false;
  let cancelSchedule: (() => void) | null = null;
  const cancel = (): void => {
    cancelled = true;
    cancelSchedule?.();
  };
  cancelDeferredHighlight = cancel;

  const processBatch = (deadline: IdleDeadlineLike): void => {
    if (cancelled || requestId !== latestRequestId) return;
    let completed = 0;
    while (blocks.length > 0 && (deadline.timeRemaining() > 4 || deadline.didTimeout) && completed < 6) {
      const block = blocks.shift();
      if (block && !block.dataset.highlighted) highlightCodeBlock(block);
      completed += 1;
    }
    if (blocks.length > 0 && !cancelled) {
      cancelSchedule = scheduleIdle(processBatch);
    } else if (cancelDeferredHighlight === cancel) {
      cancelDeferredHighlight = null;
    }
  };
  cancelSchedule = scheduleIdle(processBatch);
}

function bindContentInteractions(content: HTMLElement): void {
  content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      const href = anchor.getAttribute('href') || '';
      if (href.startsWith('#')) {
        event.preventDefault();
        const target = document.getElementById(href.slice(1));
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (isSafeExternalUrl(href)) {
        event.preventDefault();
        void openUrl(href).catch(() => { window.open(href, '_blank', 'noopener,noreferrer'); });
      }
    });
  });
}

async function setDocumentTitle(name: string): Promise<void> {
  const title = `${name} — mdread`;
  document.title = title;
  // Keep the native title in lockstep with the WebView title. This improves
  // system navigation and avoids stale window identity in desktop automation.
  await getCurrentWindow().setTitle(title).catch(() => undefined);
}

function notifyRendered(): void {
  requestAnimationFrame(() => {
    renderedCallbacks.forEach((callback) => callback());
  });
}

async function renderPayload(payload: DocumentPayload, options: { resetScroll: boolean; requestId: number }): Promise<void> {
  const content = document.getElementById('markdown-content');
  const empty = document.getElementById('empty-state');
  if (!content || !empty) return;

  const isLargeDocument = payload.byteSize > LARGE_HIGHLIGHT_THRESHOLD;
  if (isLargeDocument) showLoading('正在后台解析大文档，代码高亮将分批完成...');
  const { html: rawHtml, elapsedMs } = await parseMarkdownInWorker(payload.content, options.requestId, !isLargeDocument);
  if (options.requestId !== latestRequestId) return;

  const documentPath = activeDocumentPath(payload);
  const html = sanitizeAndTransformMarkdown(rawHtml, {
    documentPath,
    allowRemoteImages: getAppState().allowRemoteImages,
    assetUrl: convertFileSrc,
  });
  if (options.requestId !== latestRequestId) return;

  cancelDeferredHighlighting();
  await setDocumentTitle(payload.name);
  if (options.requestId !== latestRequestId) return;

  content.innerHTML = html;
  content.dataset.largeDocument = String(isLargeDocument);
  bindContentInteractions(content);
  if (isLargeDocument) scheduleDeferredCodeHighlighting(content, options.requestId);
  empty.style.display = 'none';
  content.classList.remove('hidden');
  activePayload = payload;
  activeRenderMetrics = { parseDurationMs: elapsedMs, deferredHighlight: isLargeDocument };

  if (options.resetScroll) {
    const scrollContainer = document.getElementById('content');
    if (scrollContainer) scrollContainer.scrollTop = 0;
  }

  notifyRendered();
  loadedCallbacks.forEach((callback) => callback(payload));
}

function showLoading(message = '正在加载...'): void {
  const content = document.getElementById('markdown-content');
  const empty = document.getElementById('empty-state');
  if (!content || !empty) return;
  empty.style.display = 'flex';
  empty.innerHTML = `<div class="empty-icon">⏳</div><p class="empty-title">${message}</p>`;
  content.classList.add('hidden');
}

function showError(error: AppError): void {
  cancelDeferredHighlighting();
  const content = document.getElementById('markdown-content');
  const empty = document.getElementById('empty-state');
  if (!content || !empty) return;
  empty.style.display = 'flex';
  empty.innerHTML = '<div class="empty-icon">⚠️</div><p class="empty-title">无法加载文件</p><p class="empty-hint"></p>';
  empty.querySelector('.empty-hint')!.textContent = error.message;
  content.classList.add('hidden');
  notifyRendered();
}

function queueWatchOperation(operation: () => Promise<void>): void {
  watchOperation = watchOperation.catch(() => undefined).then(operation);
}

function replaceWatch(documentRef: DocumentRef): void {
  const generation = ++watchGeneration;

  queueWatchOperation(async () => {
    const previous = activeWatchSessionId;
    activeWatchSessionId = null;
    if (previous) {
      await invoke('unwatch_document', { sessionId: previous }).catch(() => undefined);
    }

    if (generation !== watchGeneration) return;

    const watch = await invoke<{ id: string }>('watch_document', { documentRef }).catch(() => null);
    if (!watch) return;

    const stillCurrent =
      generation === watchGeneration && activePayload?.documentRef.documentId === documentRef.documentId;
    if (!stillCurrent) {
      await invoke('unwatch_document', { sessionId: watch.id }).catch(() => undefined);
      return;
    }

    activeWatchSessionId = watch.id;
  });
}

function initFileWatcher(): void {
  if (watcherInitialized) return;
  watcherInitialized = true;
  listen<FileChangedEvent>('file-changed', (event) => {
    if (activeLoadRequestId !== null) return;
    if (event.payload.sessionId === activeWatchSessionId && activePayload) {
      void reloadCurrentDocument();
    }
  }).catch(() => {
    watcherInitialized = false;
  });
}

async function readDocument(documentRef: DocumentRef, allowLarge = false): Promise<DocumentPayload> {
  return invoke<DocumentPayload>('open_document', { documentRef, allowLarge });
}

async function releaseDocumentAuthorization(documentRef: DocumentRef | null | undefined): Promise<void> {
  const documentId = documentRef?.documentId;
  if (!documentId) return;
  documentPaths.delete(documentId);
  await invoke('release_document', { documentId }).catch(() => undefined);
}

function sameDocument(left: DocumentRef | null | undefined, right: DocumentRef | null | undefined): boolean {
  return Boolean(left?.documentId && right?.documentId && left.documentId === right.documentId);
}

export async function loadDocument(documentRef: DocumentRef, options: { preserveScroll?: boolean; allowLarge?: boolean } = {}): Promise<DocumentPayload | null> {
  const requestId = ++latestRequestId;
  const previouslyActive = activePayload;
  activeLoadRequestId = requestId;
  cancelPendingMarkdownParse();
  cancelDeferredHighlighting();
  if (!options.preserveScroll) showLoading();
  initFileWatcher();

  try {
    let payload: DocumentPayload;
    try {
      payload = await readDocument(documentRef, options.allowLarge === true);
    } catch (error) {
      const structured = toAppError(error);
      if (structured.code === 'FILE_TOO_LARGE' && !options.allowLarge) {
        const size = structured.byteSize ? `${(structured.byteSize / 1024 / 1024).toFixed(1)} MiB` : '此文件';
        if (window.confirm(`${size} 的 Markdown 可能影响性能。是否继续打开？`)) {
          payload = await readDocument(documentRef, true);
        } else {
          return null;
        }
      } else {
        throw structured;
      }
    }

    if (requestId !== latestRequestId) return null;
    await renderPayload(payload, { resetScroll: !options.preserveScroll, requestId });
    if (requestId !== latestRequestId) {
      if (!sameDocument(payload.documentRef, activePayload?.documentRef)) await releaseDocumentAuthorization(payload.documentRef);
      return null;
    }
    replaceWatch(payload.documentRef);
    if (!sameDocument(previouslyActive?.documentRef, payload.documentRef)) {
      await releaseDocumentAuthorization(previouslyActive?.documentRef);
    }
    return payload;
  } catch (error) {
    if (requestId === latestRequestId) showError(toAppError(error));
    if (!sameDocument(documentRef, activePayload?.documentRef)) await releaseDocumentAuthorization(documentRef);
    return null;
  } finally {
    if (activeLoadRequestId === requestId) {
      activeLoadRequestId = null;
    }
  }
}

async function reloadCurrentDocument(): Promise<void> {
  if (!activePayload) return;
  await loadDocument(activePayload.documentRef, { preserveScroll: true, allowLarge: true });
}

/** Compatibility path for recent files, drag-and-drop and OS file associations. */
export async function loadFile(path: string): Promise<DocumentPayload | null> {
  const documentRef = await invoke<DocumentRef>('authorize_document', { path });
  if (documentRef.documentId) documentPaths.set(documentRef.documentId, path);
  const payload = await loadDocument(documentRef);
  if (!payload && !sameDocument(documentRef, activePayload?.documentRef)) {
    await releaseDocumentAuthorization(documentRef);
  }
  return payload;
}

export function getCurrentDocument(): DocumentPayload | null {
  return activePayload;
}

export function getCurrentRenderMetrics(): RenderMetrics {
  return activeRenderMetrics;
}

export async function revealCurrentDocument(): Promise<void> {
  if (!activePayload) return;
  await invoke('reveal_document', { documentRef: activePayload.documentRef });
}

export function onContentRendered(callback: () => void): () => void {
  renderedCallbacks.add(callback);
  return () => renderedCallbacks.delete(callback);
}

export function onDocumentLoaded(callback: (payload: DocumentPayload) => void): () => void {
  loadedCallbacks.add(callback);
  return () => loadedCallbacks.delete(callback);
}

export async function setRemoteImagesAllowed(allowed: boolean): Promise<void> {
  updateAppState({ allowRemoteImages: allowed });
  // Do not invalidate an in-flight document request. Otherwise toggling this
  // preference while B is loading can cancel B and repaint the old document A.
  const payload = activePayload;
  if (!payload || activeLoadRequestId !== null) return;
  const requestId = ++latestRequestId;
  await renderPayload(payload, { resetScroll: false, requestId });
}

export function areRemoteImagesAllowed(): boolean {
  return getAppState().allowRemoteImages;
}
