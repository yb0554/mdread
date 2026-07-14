/** Workspace tree with lazy loading, retryable failures and backend search. */

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getJSON, getString, remove, setJSON, StorageKeys } from './storage';
import type { FileEntry, FileSelection, SearchResponse, SearchResult, WorkspaceDescriptor } from './types';

interface StoredWorkspace {
  path: string;
}

const directoryCache = new Map<string, FileEntry[]>();
const workspaces = new Map<string, WorkspaceDescriptor>();
let container: HTMLElement | null = null;
let onFileSelectCallback: ((selection: FileSelection) => void) | null = null;
let searchRequest = 0;
let activeSearchRequestId: string | null = null;

function pathKey(workspaceId: string, relativePath = ''): string {
  return `${workspaceId}:${relativePath}`;
}

function joinPath(root: string, relativePath: string): string {
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root}${separator}${relativePath.replace(/\//g, separator)}`;
}

function normalizePath(path: string): string {
  const normalized = path.replace(/[\\/]+/g, '/').replace(/\/$/, '');
  const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
  return isWindows ? normalized.toLowerCase() : normalized;
}

function storedWorkspacePaths(): string[] {
  const saved = getJSON<unknown[]>(StorageKeys.FOLDERS, []);
  if (Array.isArray(saved) && saved.every((item) => typeof item === 'string')) {
    return saved as string[];
  }
  if (Array.isArray(saved)) {
    return saved
      .filter((item): item is StoredWorkspace => typeof item === 'object' && item !== null && 'path' in item)
      .map((item) => item.path)
      .filter((path): path is string => typeof path === 'string');
  }
  const legacy = getString(StorageKeys.LEGACY_FOLDER);
  if (legacy) {
    remove(StorageKeys.LEGACY_FOLDER);
    return [legacy];
  }
  return [];
}

function persistWorkspaces(): void {
  setJSON(StorageKeys.FOLDERS, [...workspaces.values()].map(({ path }) => ({ path })));
}

function createButton(label: string, className: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  return button;
}

function setExpanded(button: HTMLElement, children: HTMLElement, expanded: boolean): void {
  button.setAttribute('aria-expanded', String(expanded));
  children.hidden = !expanded;
}

async function listDirectory(workspaceId: string, relativePath = '', forceRefresh = false): Promise<FileEntry[]> {
  const key = pathKey(workspaceId, relativePath);
  if (!forceRefresh && directoryCache.has(key)) return directoryCache.get(key)!;
  const entries = await invoke<FileEntry[]>('list_directory', { workspaceId, relativePath: relativePath || null });
  directoryCache.set(key, entries);
  return entries;
}

function clearWorkspaceCache(workspaceId: string): void {
  for (const key of [...directoryCache.keys()]) {
    if (key.startsWith(`${workspaceId}:`)) directoryCache.delete(key);
  }
}

async function loadChildren(
  target: HTMLElement,
  workspace: WorkspaceDescriptor,
  relativePath: string,
  depth: number,
  forceRefresh = false,
): Promise<boolean> {
  target.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'tree-loading';
  loading.textContent = '加载中...';
  target.appendChild(loading);

  try {
    const entries = await listDirectory(workspace.id, relativePath, forceRefresh);
    target.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tree-loading';
      empty.textContent = '空文件夹';
      target.appendChild(empty);
    } else {
      entries.forEach((entry) => target.appendChild(createTreeNode(entry, workspace, depth)));
    }
    return true;
  } catch (error) {
    target.replaceChildren();
    const retry = createButton('加载失败，点击重试', 'tree-error', `重新加载目录：${String(error)}`);
    retry.addEventListener('click', () => {
      void loadChildren(target, workspace, relativePath, depth, true);
    });
    target.appendChild(retry);
    return false;
  }
}

function createTreeNode(entry: FileEntry, workspace: WorkspaceDescriptor, depth: number): HTMLElement {
  const node = document.createElement('div');
  node.className = entry.isDir ? 'tree-node folder' : 'tree-node file';
  node.setAttribute('role', 'treeitem');

  const row = createButton('', 'tree-node-row', entry.name);
  row.dataset.relativePath = entry.relativePath;
  row.dataset.workspaceId = workspace.id;
  row.dataset.absolutePath = joinPath(workspace.path, entry.relativePath);

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = entry.isDir ? '📁' : '📄';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = entry.name;
  row.append(icon, label);
  node.appendChild(row);

  if (entry.isDir) {
    const children = document.createElement('div');
    children.className = 'tree-children tree-node-children';
    children.setAttribute('role', 'group');
    children.hidden = true;
    node.appendChild(children);
    let loaded = false;
    let expanded = false;
    row.setAttribute('aria-expanded', 'false');
    row.addEventListener('click', async () => {
      expanded = !expanded;
      icon.textContent = expanded ? '📂' : '📁';
      setExpanded(row, children, expanded);
      if (expanded && !loaded) loaded = await loadChildren(children, workspace, entry.relativePath, depth + 1);
    });
  } else {
    row.addEventListener('click', () => selectFile({
      documentRef: { workspaceId: workspace.id, relativePath: entry.relativePath },
      absolutePath: joinPath(workspace.path, entry.relativePath),
    }, node));
  }

  return node;
}

function createRootNode(workspace: WorkspaceDescriptor): HTMLElement {
  const root = document.createElement('section');
  root.className = 'tree-root';
  root.dataset.workspaceId = workspace.id;
  root.dataset.workspacePath = workspace.path;
  root.setAttribute('role', 'treeitem');

  const header = document.createElement('div');
  header.className = 'tree-root-header';
  const toggle = createButton('📂', 'tree-root-toggle', `折叠工作区 ${workspace.name}`);
  toggle.setAttribute('aria-expanded', 'true');
  const label = createButton(workspace.name, 'tree-root-label', workspace.path);
  label.title = workspace.path;
  const refresh = createButton('↻', 'tree-refresh-btn', `刷新工作区 ${workspace.name}`);
  const removeButton = createButton('×', 'tree-remove-btn', `移除工作区 ${workspace.name}`);
  header.append(toggle, label, refresh, removeButton);

  const children = document.createElement('div');
  children.className = 'tree-children';
  children.setAttribute('role', 'group');
  root.append(header, children);

  let expanded = true;
  let loaded = false;
  const toggleRoot = async (force?: boolean): Promise<void> => {
    expanded = force ?? !expanded;
    toggle.textContent = expanded ? '📂' : '📁';
    toggle.title = `${expanded ? '折叠' : '展开'}工作区 ${workspace.name}`;
    setExpanded(toggle, children, expanded);
    if (expanded && !loaded) loaded = await loadChildren(children, workspace, '', 1);
  };
  toggle.addEventListener('click', () => void toggleRoot());
  label.addEventListener('click', () => void toggleRoot());
  refresh.addEventListener('click', async () => {
    clearWorkspaceCache(workspace.id);
    loaded = await loadChildren(children, workspace, '', 1, true);
    if (!expanded) await toggleRoot(true);
  });
  removeButton.addEventListener('click', async () => {
    await invoke('remove_workspace', { workspaceId: workspace.id }).catch(() => undefined);
    workspaces.delete(workspace.id);
    clearWorkspaceCache(workspace.id);
    persistWorkspaces();
    root.remove();
  });

  void loadChildren(children, workspace, '', 1).then((success) => { loaded = success; });
  return root;
}

function selectFile(selection: FileSelection, node?: HTMLElement): void {
  document.querySelectorAll('.tree-node.file.selected').forEach((item) => item.classList.remove('selected'));
  node?.classList.add('selected');
  onFileSelectCallback?.(selection);
}

function installTreeKeyboardNavigation(target: HTMLElement): void {
  target.onkeydown = (event) => {
    const active = document.activeElement as HTMLButtonElement | null;
    if (!active?.matches('.tree-node-row, .tree-root-toggle, .tree-root-label')) return;
    const rows = [...target.querySelectorAll<HTMLButtonElement>('.tree-node-row, .tree-root-toggle, .tree-root-label')]
      .filter((button) => !button.closest('[hidden]'));
    const index = rows.indexOf(active);
    if (index < 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const nextIndex = event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1)
        : event.key === 'ArrowUp' ? Math.max(0, index - 1)
          : event.key === 'Home' ? 0 : rows.length - 1;
      rows[nextIndex]?.focus();
      return;
    }
    if (event.key === 'ArrowRight' && active.getAttribute('aria-expanded') === 'false') {
      event.preventDefault();
      active.click();
      return;
    }
    if (event.key === 'ArrowLeft' && active.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      active.click();
    }
  };
}

export async function initializeFileTree(target: HTMLElement): Promise<void> {
  container = target;
  target.setAttribute('role', 'tree');
  target.setAttribute('aria-label', 'Markdown 文件树');
  installTreeKeyboardNavigation(target);
  target.replaceChildren();
  workspaces.clear();

  for (const path of [...new Set(storedWorkspacePaths())]) {
    try {
      const workspace = await invoke<WorkspaceDescriptor>('register_workspace', { path });
      workspaces.set(workspace.id, workspace);
      target.appendChild(createRootNode(workspace));
    } catch {
      // Missing or revoked paths are not restored; they are removed below.
    }
  }
  persistWorkspaces();
}

export async function pickFolder(): Promise<WorkspaceDescriptor | null> {
  const selected = await open({ directory: true, multiple: false });
  if (!selected || typeof selected !== 'string') return null;
  const workspace = await invoke<WorkspaceDescriptor>('register_workspace', { path: selected });
  if (workspaces.has(workspace.id)) return null;
  workspaces.set(workspace.id, workspace);
  persistWorkspaces();
  return workspace;
}

export function appendFolder(workspace: WorkspaceDescriptor): void {
  if (!container) return;
  container.appendChild(createRootNode(workspace));
}

export function onFileSelect(callback: (selection: FileSelection) => void): void {
  onFileSelectCallback = callback;
}

function directTreeNode(children: HTMLElement, relativePath: string): HTMLElement | null {
  return Array.from(children.children).find((candidate): candidate is HTMLElement => {
    if (!(candidate instanceof HTMLElement) || !candidate.classList.contains('tree-node')) return false;
    const row = candidate.firstElementChild as HTMLElement | null;
    return row?.dataset.relativePath === relativePath;
  }) ?? null;
}

async function waitForChildren(children: HTMLElement): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const loading = Array.from(children.children).some((child) => child.classList.contains('tree-loading'));
    if (!loading) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
  }
}

async function expandWorkspacePath(selection: FileSelection): Promise<void> {
  const workspaceId = selection.documentRef.workspaceId;
  const relativePath = selection.documentRef.relativePath;
  if (!workspaceId || !relativePath) return;
  const root = container?.querySelector<HTMLElement>(`.tree-root[data-workspace-id="${CSS.escape(workspaceId)}"]`);
  if (!root) return;

  const rootToggle = root.querySelector<HTMLButtonElement>(':scope > .tree-root-header .tree-root-toggle');
  const rootChildren = root.querySelector<HTMLElement>(':scope > .tree-children');
  if (!rootToggle || !rootChildren) return;
  if (rootToggle.getAttribute('aria-expanded') !== 'true') rootToggle.click();
  await waitForChildren(rootChildren);

  const segments = relativePath.split('/').filter(Boolean);
  let parent = rootChildren;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const folderPath = segments.slice(0, index + 1).join('/');
    const folder = directTreeNode(parent, folderPath);
    const row = folder?.firstElementChild as HTMLButtonElement | null;
    const children = folder?.querySelector<HTMLElement>(':scope > .tree-children');
    if (!row || !children) return;
    if (row.getAttribute('aria-expanded') !== 'true') row.click();
    await waitForChildren(children);
    parent = children;
  }
}

export async function syncSelectedPath(absolutePath: string): Promise<void> {
  const wanted = normalizePath(absolutePath);
  const selection = findWorkspaceDocument(absolutePath);
  if (selection) await expandWorkspacePath(selection);
  document.querySelectorAll<HTMLElement>('.tree-node.file').forEach((node) => {
    const candidate = node.querySelector<HTMLElement>(':scope > .tree-node-row')?.dataset.absolutePath;
    node.classList.toggle('selected', candidate ? normalizePath(candidate) === wanted : false);
  });
  const selected = document.querySelector<HTMLElement>('.tree-node.file.selected > .tree-node-row');
  selected?.scrollIntoView({ block: 'nearest' });
}

export function findWorkspaceDocument(path: string): FileSelection | null {
  const normalized = normalizePath(path);
  const candidates = [...workspaces.values()]
    .filter((workspace) => normalized.startsWith(`${normalizePath(workspace.path)}/`))
    .sort((left, right) => right.path.length - left.path.length);
  const workspace = candidates[0];
  if (!workspace) return null;
  const relativePath = normalized.slice(normalizePath(workspace.path).length + 1);
  return {
    documentRef: { workspaceId: workspace.id, relativePath },
    absolutePath: path,
  };
}

async function cancelActiveSearch(): Promise<void> {
  const requestId = activeSearchRequestId;
  activeSearchRequestId = null;
  if (!requestId) return;
  await invoke('cancel_search', { requestId }).catch(() => undefined);
}

export async function searchWorkspaces(query: string, mode: 'filename' | 'content' = 'filename'): Promise<void> {
  if (!container) return;
  const requestId = ++searchRequest;
  void cancelActiveSearch();
  const existing = container.querySelector('.workspace-search-results');
  existing?.remove();
  const roots = container.querySelectorAll<HTMLElement>('.tree-root');
  const trimmed = query.trim();
  if (!trimmed) {
    roots.forEach((root) => { root.hidden = false; });
    return;
  }

  roots.forEach((root) => { root.hidden = true; });
  const resultsPanel = document.createElement('div');
  resultsPanel.className = 'workspace-search-results tree-children';
  resultsPanel.setAttribute('role', 'status');
  resultsPanel.setAttribute('aria-live', 'polite');
  resultsPanel.setAttribute('aria-label', `${mode === 'content' ? '内容搜索' : '文件名搜索'}结果：${trimmed}`);
  resultsPanel.textContent = '搜索中…';
  container.appendChild(resultsPanel);

  const backendRequestId = `search-${Date.now()}-${requestId}`;
  activeSearchRequestId = backendRequestId;
  const groups = await Promise.all([...workspaces.values()].map(async (workspace) => {
    try {
      const response = await invoke<SearchResponse>('search_workspace', {
        workspaceId: workspace.id,
        query: trimmed,
        mode,
        limit: 100,
        requestId: backendRequestId,
      });
      return { workspace, ...response };
    } catch {
      return { workspace, results: [] as SearchResult[], cancelled: false };
    }
  }));
  if (requestId !== searchRequest) return;
  if (activeSearchRequestId === backendRequestId) activeSearchRequestId = null;

  resultsPanel.replaceChildren();
  if (groups.length > 0 && groups.every((group) => group.cancelled)) {
    resultsPanel.textContent = '搜索已取消';
    return;
  }
  const results = groups.flatMap(({ workspace, results: items }) => items.map((result) => ({ workspace, result })));
  if (results.length === 0) {
    resultsPanel.textContent = '没有匹配的 Markdown 文件';
    return;
  }
  results.forEach(({ workspace, result }) => {
    const item = createButton(result.name, 'tree-node-row search-result', result.relativePath);
    item.innerHTML = '<span class="tree-icon" aria-hidden="true">📄</span><span class="tree-label"></span>';
    item.querySelector('.tree-label')!.textContent = `${workspace.name} / ${result.relativePath}`;
    if (result.snippet) {
      const snippet = document.createElement('small');
      snippet.className = 'search-snippet';
      snippet.textContent = result.snippet;
      item.appendChild(snippet);
    }
    item.addEventListener('click', () => selectFile({
      documentRef: result.documentRef,
      absolutePath: joinPath(workspace.path, result.relativePath),
    }));
    resultsPanel.appendChild(item);
  });
}

export function getWorkspaceCount(): number {
  return workspaces.size;
}
