/**
 * mdread 文件树侧边栏
 * - 多文件夹: 支持添加多个根目录, 每个可独立移除
 * - 懒加载: 仅在用户点击展开文件夹时加载子目录
 * - 缓存: 使用 Map 避免重复请求同一目录
 */

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { StorageKeys, getJSON, setJSON, getString, remove } from './storage';

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  extension: string | null;
}

const dirCache = new Map<string, FileEntry[]>();
let onFileSelectCallback: ((path: string) => void) | null = null;

/**
 * 打开文件夹选择对话框, 添加到列表
 * @returns 新增的路径, 用户取消则返回 null
 */
export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  if (selected && typeof selected === 'string') {
    const folders = getFolders();
    if (!folders.includes(selected)) {
      folders.push(selected);
      saveFolders(folders);
      return selected;
    }
    // 已存在则不重复添加
    return null;
  }
  return null;
}

/**
 * 获取已保存的文件夹列表
 */
export function getFolders(): string[] {
  const folders = getJSON<string[] | null>(StorageKeys.FOLDERS, null);
  if (folders) {
    return folders;
  }
  // 迁移旧版单文件夹键
  const legacy = getString(StorageKeys.LEGACY_FOLDER);
  if (legacy) {
    const migrated = [legacy];
    setJSON(StorageKeys.FOLDERS, migrated);
    remove(StorageKeys.LEGACY_FOLDER);
    return migrated;
  }
  return [];
}

/**
 * 保存文件夹列表
 */
function saveFolders(folders: string[]): void {
  setJSON(StorageKeys.FOLDERS, folders);
}

/**
 * 移除指定文件夹
 */
export function removeFolder(path: string): void {
  const folders = getFolders().filter(f => f !== path);
  saveFolders(folders);
  // 清除该文件夹及其所有子目录的缓存
  for (const key of [...dirCache.keys()]) {
    if (key === path || key.startsWith(path + '\\') || key.startsWith(path + '/')) {
      dirCache.delete(key);
    }
  }
}

/**
 * 渲染文件树 — 支持多根目录
 * @param container 文件树容器
 */
export async function renderFileTree(container: HTMLElement): Promise<void> {
  container.innerHTML = '';
  const folders = getFolders();

  if (folders.length === 0) {
    // 空状态由 CSS ::before 处理
    return;
  }

  for (const folderPath of folders) {
    const rootEl = createRootNode(folderPath);
    container.appendChild(rootEl);
  }
}

/**
 * 追加单个新文件夹到文件树 (不重渲染全部)
 */
export async function appendFolder(container: HTMLElement, folderPath: string): Promise<void> {
  const rootEl = createRootNode(folderPath);
  container.appendChild(rootEl);
}

/**
 * 创建根文件夹节点 (带移除按钮)
 */
function createRootNode(folderPath: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-root';

  const header = document.createElement('div');
  header.className = 'tree-root-header';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = '📂';

  const label = document.createElement('span');
  label.className = 'tree-label';
  // 只显示文件夹名, 如果无法获取则显示完整路径
  const folderName = folderPath.split(/[\\/]/).pop() || folderPath;
  label.textContent = folderName;
  label.title = folderPath;

  const removeBtn = document.createElement('span');
  removeBtn.className = 'tree-remove-btn';
  removeBtn.textContent = '×';
  removeBtn.title = '移除此文件夹';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeFolder(folderPath);
    wrapper.remove();
  });

  header.appendChild(icon);
  header.appendChild(label);
  header.appendChild(removeBtn);

  // 点击根标题切换展开/折叠
  let expanded = true;
  let loaded = false;
  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'tree-children';

  header.addEventListener('click', async () => {
    expanded = !expanded;
    icon.textContent = expanded ? '📂' : '📁';
    childrenContainer.style.display = expanded ? 'block' : 'none';

    if (expanded && !loaded) {
      loaded = true;
      await loadChildren(childrenContainer, folderPath, 1);
    }
  });

  wrapper.appendChild(header);
  wrapper.appendChild(childrenContainer);

  // 初始加载 — 同步设置 loaded 防止竞态
  loaded = true;
  loadChildren(childrenContainer, folderPath, 1);

  return wrapper;
}

/**
 * 加载子目录内容
 */
async function loadChildren(container: HTMLElement, path: string, depth: number): Promise<void> {
  const loadingEl = document.createElement('div');
  loadingEl.className = 'tree-loading';
  loadingEl.textContent = '加载中...';
  loadingEl.style.paddingLeft = `${depth * 16 + 8}px`;
  container.appendChild(loadingEl);

  try {
    const entries = await listDirectory(path);
    container.removeChild(loadingEl);

    if (entries.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'tree-loading';
      emptyEl.textContent = '空文件夹';
      emptyEl.style.paddingLeft = `${depth * 16 + 8}px`;
      container.appendChild(emptyEl);
    } else {
      for (const entry of entries) {
        container.appendChild(createTreeNode(entry, depth));
      }
    }
  } catch (err) {
    container.removeChild(loadingEl);
    const errorEl = document.createElement('div');
    errorEl.className = 'tree-error';
    errorEl.textContent = `加载失败: ${err}`;
    errorEl.style.paddingLeft = `${depth * 16 + 8}px`;
    container.appendChild(errorEl);
  }
}

/**
 * 列出目录内容 (带缓存)
 */
async function listDirectory(path: string): Promise<FileEntry[]> {
  if (dirCache.has(path)) {
    return dirCache.get(path)!;
  }
  const entries = await invoke<FileEntry[]>('list_directory', { path });
  dirCache.set(path, entries);
  return entries;
}

/**
 * 创建树节点
 */
function createTreeNode(entry: FileEntry, depth: number): HTMLElement {
  const node = document.createElement('div');
  node.className = entry.is_dir ? 'tree-node folder' : 'tree-node file';

  // 行容器: 图标 + 标签 (横向 flex)
  const row = document.createElement('div');
  row.className = 'tree-node-row';
  row.style.paddingLeft = `${depth * 16 + 8}px`;

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = entry.is_dir ? '📁' : '📄';

  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = entry.name;

  row.appendChild(icon);
  row.appendChild(label);
  node.appendChild(row);

  if (entry.is_dir) {
    let expanded = false;
    let loaded = false;
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';
    childrenContainer.style.display = 'none';
    node.appendChild(childrenContainer);

    row.addEventListener('click', async (e) => {
      e.stopPropagation();
      expanded = !expanded;
      icon.textContent = expanded ? '📂' : '📁';
      childrenContainer.style.display = expanded ? 'block' : 'none';

      if (expanded && !loaded) {
        loaded = true;
        await loadChildren(childrenContainer, entry.path, depth + 1);
      }
    });
  } else {
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      selectFile(entry.path, node);
    });
  }

  return node;
}

/**
 * 选中文件
 */
function selectFile(path: string, node: HTMLElement): void {
  document.querySelectorAll('.tree-node.file.selected').forEach((el) => {
    el.classList.remove('selected');
  });
  node.classList.add('selected');
  if (onFileSelectCallback) {
    onFileSelectCallback(path);
  }
}

/**
 * 注册文件选中回调
 */
export function onFileSelect(callback: (path: string) => void): void {
  onFileSelectCallback = callback;
}
