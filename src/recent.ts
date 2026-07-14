/** Recent documents with fully keyboard-accessible controls. */

import { StorageKeys, getJSON, setJSON, remove } from './storage';

const MAX_RECENT = 10;

let onOpenCallback: ((path: string) => void) | null = null;
let expanded = false;

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
  renderRecent();
}

function getRecent(): string[] {
  return getJSON<string[]>(StorageKeys.RECENT_FILES, []);
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

    const openButton = createButton('', 'recent-open-btn', `打开最近文件：${path}`);
    const icon = document.createElement('span');
    icon.className = 'recent-icon';
    icon.textContent = '📄';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'recent-label';
    label.textContent = path.split(/[\/]/).pop() || path;
    label.title = path;
    openButton.append(icon, label);
    openButton.addEventListener('click', () => onOpenCallback?.(path));

    const removeButton = createButton('×', 'recent-remove-btn', `从最近文件中移除：${path}`);
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
