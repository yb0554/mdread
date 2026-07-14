/** Application composition and user-facing reading workflow. */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import {
  appendFolder,
  findWorkspaceDocument,
  initializeFileTree,
  onFileSelect,
  pickFolder,
  syncSelectedPath,
} from './filetree';
import { exportToPdf } from './export-service';
import { formatDisplayPath } from './path-display';
import { initDragDrop } from './dragdrop';
import { initHistory, pushHistory } from './history';
import { initOutline, toggleOutline } from './outline';
import { addRecent, clearRecent, initRecent } from './recent';
import {
  areRemoteImagesAllowed,
  loadDocument,
  loadFile,
  onDocumentLoaded,
  revealCurrentDocument,
  setRemoteImagesAllowed,
} from './renderer';
import { initSearch } from './search';
import { initShortcuts } from './shortcuts';
import { selectMarkdownPath, type OpenDocumentsPayload } from './system-open';
import { getAppState, updateAppState } from './storage';
import {
  getCurrentFont,
  getCurrentThemePreference,
  getFontOptions,
  getThemeOptions,
  initTheme,
  setFont,
  setTheme,
} from './theme';
import type { DocumentPayload, FileSelection } from './types';

let activePath: string | null = null;

// The WDIO bridge is only bundled into the dedicated E2E build.
if (import.meta.env.VITE_E2E === 'true') {
  void import('@wdio/tauri-plugin');
}

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initMenu();
  initSearch();
  initOutline();
  setupSidebarResizer();

  const fileTree = document.getElementById('file-tree');
  if (!fileTree) return;
  await initializeFileTree(fileTree);

  onFileSelect((selection) => {
    void openSelection(selection, { recordRecent: true, pushNavigation: true });
  });

  initShortcuts({ addWorkspace });
  initHistory((path) => { void openPath(path); });
  initRecent((path) => { void openPath(path, { recordRecent: false, pushNavigation: true }); });
  void initDragDrop((path) => { void openPath(path, { recordRecent: true, pushNavigation: true }); });
  renderFavorites();

  onDocumentLoaded((payload) => updateDocumentMetadata(payload));

  const openedBySystem = await initSystemOpenIntegration();
  const lastDocument = getAppState().lastDocument;
  if (!openedBySystem && lastDocument) {
    // Await session restoration so it cannot race a user's first file-tree
    // selection and repaint a stale document after the new request begins.
    await openPath(lastDocument, { recordRecent: false, pushNavigation: false });
  }
  if (import.meta.env.VITE_E2E === 'true') {
    document.documentElement.dataset.e2eReady = 'true';
  }
});

interface OpenOptions {
  recordRecent?: boolean;
  pushNavigation?: boolean;
}

async function openSelection(selection: FileSelection, options: OpenOptions = {}): Promise<boolean> {
  const payload = await loadDocument(selection.documentRef);
  if (!payload) return false;
  activePath = selection.absolutePath;
  await syncSelectedPath(selection.absolutePath);
  finishOpen(selection.absolutePath, payload, options);
  return true;
}

async function openPath(path: string, options: OpenOptions = {}): Promise<boolean> {
  const selection = findWorkspaceDocument(path);
  if (selection) {
    return openSelection(selection, options);
  }

  const payload = await loadFile(path);
  if (!payload) return false;
  activePath = path;
  await syncSelectedPath(path);
  finishOpen(path, payload, options);
  return true;
}

async function initSystemOpenIntegration(): Promise<boolean> {
  await listen<OpenDocumentsPayload>('open-documents', (event) => {
    void openSystemDocument(event.payload.paths);
  });

  try {
    const paths = await invoke<string[]>('take_initial_launch_paths');
    return openSystemDocument(paths);
  } catch (error) {
    console.warn('无法读取系统启动文件:', error);
    return false;
  }
}

async function openSystemDocument(paths: readonly string[] | undefined): Promise<boolean> {
  const path = selectMarkdownPath(paths);
  if (!path) return false;
  return openPath(path, { recordRecent: true, pushNavigation: true });
}

function finishOpen(path: string, payload: DocumentPayload, options: OpenOptions): void {
  updateAppState({ lastDocument: path });
  if (options.recordRecent !== false) addRecent(path);
  if (options.pushNavigation !== false) pushHistory(path);
  updateDocumentMetadata(payload);
  renderFavorites();
}

async function addWorkspace(): Promise<void> {
  const workspace = await pickFolder();
  if (workspace) appendFolder(workspace);
}

function updateDocumentMetadata(payload: DocumentPayload): void {
  const meta = document.getElementById('document-meta');
  if (!meta) return;
  const size = formatBytes(payload.byteSize);
  const minutes = Math.max(1, Math.ceil(payload.content.trim().split(/\s+/).filter(Boolean).length / 220));
  const path = formatDisplayPath(activePath ?? payload.name);
  meta.textContent = `${path} · ${size} · 预计阅读 ${minutes} 分钟${payload.warnings.length ? ` · ${payload.warnings.join('；')}` : ''}`;
  meta.title = path;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function renderFavorites(): void {
  const container = document.getElementById('favorite-files');
  if (!container) return;
  const favorites = getAppState().favorites;
  container.replaceChildren();
  container.hidden = favorites.length === 0;
  if (favorites.length === 0) return;

  const heading = document.createElement('div');
  heading.className = 'recent-header';
  heading.textContent = '收藏';
  container.appendChild(heading);

  for (const path of favorites.slice(0, 10)) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'recent-item';
    item.title = path;
    const icon = document.createElement('span');
    icon.className = 'recent-icon';
    icon.textContent = '★';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'recent-label';
    label.textContent = path.split(/[\\/]/).pop() || path;
    item.append(icon, label);
    item.addEventListener('click', () => { void openPath(path, { recordRecent: true, pushNavigation: true }); });
    container.appendChild(item);
  }
}

function toggleFavorite(): void {
  if (!activePath) return;
  const state = getAppState();
  const exists = state.favorites.includes(activePath);
  updateAppState({
    favorites: exists ? state.favorites.filter((path) => path !== activePath) : [activePath, ...state.favorites].slice(0, 100),
  });
  renderFavorites();
  const popup = document.getElementById('menu-popup');
  if (popup) buildMenuContent(popup);
}

function initMenu(): void {
  const menuBtn = document.getElementById('menu-btn');
  const popup = document.getElementById('menu-popup');
  if (!menuBtn || !popup) return;
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-controls', 'menu-popup');
  buildMenuContent(popup);

  menuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = popup.classList.toggle('hidden') === false;
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => hidePopup());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePopup();
  });
}

function buildMenuContent(popup: HTMLElement): void {
  popup.replaceChildren();
  popup.setAttribute('role', 'menu');
  popup.appendChild(createMenuItem('📁 添加文件夹', () => { void addWorkspace(); }));
  popup.appendChild(createMenuItem('★ 收藏/取消收藏当前文档', toggleFavorite, !activePath));
  popup.appendChild(createMenuItem('📂 在文件管理器中显示当前文档', () => { void revealCurrentDocument(); }, !activePath));
  popup.appendChild(createMenuItem('☰ 显示/隐藏目录', () => toggleOutline()));
  popup.appendChild(createMenuItem('🖨 打印 / 导出 PDF', exportToPdf));
  popup.appendChild(createMenuItem(
    areRemoteImagesAllowed() ? '🖼 禁止远程图片' : '🖼 允许远程图片',
    () => { void setRemoteImagesAllowed(!areRemoteImagesAllowed()).then(() => buildMenuContent(popup)); },
  ));

  popup.appendChild(createMenuSeparator());
  popup.appendChild(createMenuLabel('主题'));
  for (const option of getThemeOptions()) {
    popup.appendChild(createMenuOption(option.label, option.value === getCurrentThemePreference(), () => {
      setTheme(option.value);
      buildMenuContent(popup);
    }));
  }

  popup.appendChild(createMenuSeparator());
  popup.appendChild(createMenuLabel('字体'));
  for (const option of getFontOptions()) {
    popup.appendChild(createMenuOption(option.label, option.value === getCurrentFont(), () => {
      setFont(option.value);
      buildMenuContent(popup);
    }));
  }

  popup.appendChild(createMenuSeparator());
  popup.appendChild(createMenuItem('🗑 清空最近文件', clearRecent));
}

function createMenuItem(text: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'menu-item';
  item.textContent = text;
  item.disabled = disabled;
  item.setAttribute('role', 'menuitem');
  item.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
    hidePopup();
  });
  return item;
}

function createMenuOption(text: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const item = createMenuItem(`${active ? '✓ ' : ''}${text}`, onClick);
  item.classList.add('menu-option');
  item.setAttribute('role', 'menuitemradio');
  item.setAttribute('aria-checked', String(active));
  return item;
}

function createMenuLabel(text: string): HTMLElement {
  const label = document.createElement('div');
  label.className = 'menu-label';
  label.textContent = text;
  return label;
}

function createMenuSeparator(): HTMLElement {
  const separator = document.createElement('div');
  separator.className = 'menu-separator';
  separator.setAttribute('role', 'separator');
  return separator;
}

function hidePopup(): void {
  const popup = document.getElementById('menu-popup');
  const button = document.getElementById('menu-btn');
  popup?.classList.add('hidden');
  button?.setAttribute('aria-expanded', 'false');
}

function setupSidebarResizer(): void {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.getElementById('sidebar');
  if (!resizer || !sidebar) return;

  const savedWidth = getAppState().sidebarWidth;
  if (savedWidth && savedWidth >= 200 && savedWidth <= 500) sidebar.style.width = `${savedWidth}px`;

  let resizing = false;
  resizer.addEventListener('mousedown', (event) => {
    resizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.preventDefault();
  });
  document.addEventListener('mousemove', (event) => {
    if (!resizing) return;
    const width = Math.max(200, Math.min(500, event.clientX));
    sidebar.style.width = `${width}px`;
  });
  document.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    updateAppState({ sidebarWidth: sidebar.getBoundingClientRect().width });
  });
}
