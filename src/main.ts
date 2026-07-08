/**
 * mdread 主入口
 * 统一菜单 + 模块装配
 */

import { initTheme, setTheme, getCurrentTheme, getThemeOptions, setFont, getCurrentFont, getFontOptions } from './theme';
import { pickFolder, renderFileTree, appendFolder, onFileSelect, getFolders } from './filetree';
import { loadFile } from './renderer';
import { initOutline, toggleOutline } from './outline';
import { initShortcuts } from './shortcuts';
import { initSearch } from './search';
import { initRecent, addRecent, clearRecent } from './recent';
import { initDragDrop } from './dragdrop';
import { initHistory, pushHistory } from './history';

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initMenu();
  initSearch();

  const fileTree = document.getElementById('file-tree')!;

  onFileSelect((path) => {
    loadFile(path);
    addRecent(path);
    pushHistory(path);
  });

  // 恢复已保存的文件夹列表
  if (getFolders().length > 0) {
    await renderFileTree(fileTree);
  }

  setupSidebarResizer();
  initOutline();
  initShortcuts();
  initHistory((p) => loadFile(p));
  initRecent((p) => { loadFile(p); pushHistory(p); });
  initDragDrop((p) => { loadFile(p); pushHistory(p); });
});

// === 统一菜单 ===

function initMenu(): void {
  const menuBtn = document.getElementById('menu-btn')!;
  const popup = document.getElementById('menu-popup')!;

  buildMenuContent(popup);

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    popup.classList.add('hidden');
  });
}

function buildMenuContent(popup: HTMLElement): void {
  popup.innerHTML = '';

  // 添加文件夹
  popup.appendChild(createMenuItem('📁 添加文件夹', async () => {
    const folderPath = await pickFolder();
    if (folderPath) {
      await appendFolder(document.getElementById('file-tree')!, folderPath);
    }
  }));

  // 显示/隐藏目录
  popup.appendChild(createMenuItem('☰ 显示/隐藏目录', () => {
    toggleOutline();
  }));

  // 分隔线
  popup.appendChild(createMenuSeparator());

  // 主题选项
  const themeLabel = createMenuLabel('主题');
  popup.appendChild(themeLabel);
  for (const opt of getThemeOptions()) {
    const item = createMenuOption(opt.label, opt.value === getCurrentTheme(), () => {
      setTheme(opt.value);
      rebuildMenu(popup);
    });
    popup.appendChild(item);
  }

  // 分隔线
  popup.appendChild(createMenuSeparator());

  // 字体选项
  popup.appendChild(createMenuLabel('字体'));
  for (const opt of getFontOptions()) {
    const item = createMenuOption(opt.label, opt.value === getCurrentFont(), () => {
      setFont(opt.value);
    });
    popup.appendChild(item);
  }

  // 分隔线
  popup.appendChild(createMenuSeparator());

  // 清空最近文件
  popup.appendChild(createMenuItem('🗑 清空最近文件', () => {
    clearRecent();
  }));
}

function rebuildMenu(popup: HTMLElement): void {
  buildMenuContent(popup);
}

function createMenuItem(text: string, onClick: () => void): HTMLElement {
  const item = document.createElement('div');
  item.className = 'menu-item';
  item.textContent = text;
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
    hidePopup();
  });
  return item;
}

function createMenuOption(text: string, active: boolean, onClick: () => void): HTMLElement {
  const item = document.createElement('div');
  item.className = 'menu-option' + (active ? ' active' : '');
  item.textContent = text;
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
    const popup = document.getElementById('menu-popup')!;
    rebuildMenu(popup);
    hidePopup();
  });
  return item;
}

function createMenuLabel(text: string): HTMLElement {
  const label = document.createElement('div');
  label.className = 'menu-label';
  label.textContent = text;
  return label;
}

function createMenuSeparator(): HTMLElement {
  const sep = document.createElement('div');
  sep.className = 'menu-separator';
  return sep;
}

function hidePopup(): void {
  document.getElementById('menu-popup')?.classList.add('hidden');
}

// === 侧边栏拖拽 ===

function setupSidebarResizer(): void {
  const resizer = document.getElementById('sidebar-resizer')!;
  const sidebar = document.getElementById('sidebar')!;
  let isResizing = false;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = Math.max(200, Math.min(500, e.clientX));
    sidebar.style.width = `${newWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}
