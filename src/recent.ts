/** Recent documents with compact labels, keyboard support, and path actions. */

import { StorageKeys, getJSON, setJSON, remove } from './storage';
import { formatDisplayPath, getPathFileName } from './path-display';

const MAX_RECENT = 10;

let onOpenCallback: ((path: string) => void) | null = null;
let expanded = false;
let contextMenu: HTMLElement | null = null;
let contextEventsBound = false;

function createButton(text: string, className: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

export function initRecent(onOpen: (path: string) => void): void {
  onOpenCallback = onOpen;
  bindContextMenuEvents();
  renderRecent();
}

export function addRecent(path: string): void {
  let recent = getRecent().filter((item) => item !== path);
  recent.unshift(path);
  recent = recent.slice(0, MAX_RECENT);
  setJSON(StorageKeys.RECENT_FILES, recent);
  expanded = false;
  renderRecent();
}

export function removeRecent(path: string): void {
  setJSON(StorageKeys.RECENT_FILES, getRecent().filter((item) => item !== path));
  renderRecent();
}

export function clearRecent(): void {
  remove(StorageKeys.RECENT_FILES);
  expanded = false;
  hideRecentContextMenu();
  renderRecent();
}

function getRecent(): string[] {
  return getJSON<string[]>(StorageKeys.RECENT_FILES, []);
}

function bindContextMenuEvents(): void {
  if (contextEventsBound) return;
  contextEventsBound = true;
  document.addEventListener('pointerdown', (event) => {
    if (contextMenu && !contextMenu.contains(event.target as Node)) hideRecentContextMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideRecentContextMenu();
  });
}

function renderRecent(): void {
  const container = document.getElementById('recent-files');
  if (!container) return;

  const recent = getRecent();
  container.replaceChildren();
  container.style.display = recent.length > 0 ? 'block' : 'none';
  if (recent.length === 0) return;

  const header = document.createElement('div');
  header.className = 'recent-header';
  const title = document.createElement('span');
  title.textContent = '最近打开';
  const clearButton = createButton('清空', 'recent-clear-btn', '清空最近文件');
  clearButton.addEventListener('click', clearRecent);
  header.append(title, clearButton);
  container.appendChild(header);

  const visibleItems = recent.slice(0, expanded ? recent.length : 1);
  for (const path of visibleItems) {
    const item = document.createElement('div');
    item.className = 'recent-item';

    const displayPath = formatDisplayPath(path);
    const fileName = getPathFileName(path);
    const openButton = createButton('', 'recent-open-btn', `打开最近文件：${fileName}。右键可复制完整路径`);
    const icon = document.createElement('span');
    icon.className = 'recent-icon';
    icon.textContent = '📄';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'recent-label';
    label.textContent = fileName;
    label.title = displayPath;
    openButton.append(icon, label);
    openButton.addEventListener('click', () => onOpenCallback?.(path));
    openButton.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showRecentContextMenu(displayPath, event.clientX, event.clientY);
    });
    openButton.addEventListener('keydown', (event) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      const bounds = openButton.getBoundingClientRect();
      showRecentContextMenu(displayPath, bounds.left + 12, bounds.bottom + 4);
    });

    const removeButton = createButton('×', 'recent-remove-btn', `从最近文件中移除：${fileName}`);
    removeButton.addEventListener('click', () => removeRecent(path));
    item.append(openButton, removeButton);
    container.appendChild(item);
  }

  if (recent.length > 1) {
    const toggle = createButton(expanded ? '收起 ▲' : `还有 ${recent.length - 1} 个 ▼`, 'recent-toggle', expanded ? '收起最近文件列表' : '展开最近文件列表');
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      renderRecent();
    });
    container.appendChild(toggle);
  }
}

function showRecentContextMenu(displayPath: string, x: number, y: number): void {
  hideRecentContextMenu();
  const menu = document.createElement('div');
  menu.className = 'recent-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '最近文件操作');
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 236))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 52))}px`;

  const copyButton = createButton('复制完整路径', 'recent-context-menu-item', '复制完整文件路径');
  copyButton.setAttribute('role', 'menuitem');
  copyButton.addEventListener('click', () => {
    void copyPath(displayPath).then(() => {
      copyButton.textContent = '已复制路径';
      window.setTimeout(hideRecentContextMenu, 600);
    });
  });
  menu.appendChild(copyButton);
  document.body.appendChild(menu);
  contextMenu = menu;
  copyButton.focus();
}

async function copyPath(path: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(path);
      return;
    } catch {
      // Fall back for WebView environments without Clipboard API permission.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = path;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function hideRecentContextMenu(): void {
  contextMenu?.remove();
  contextMenu = null;
}
