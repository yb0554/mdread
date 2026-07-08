/**
 * mdread 键盘快捷键 + 字体缩放
 * - Ctrl+O: 直接打开文件夹选择对话框
 * - Ctrl+B: 切换侧边栏 (持久化)
 * - Ctrl+Shift+O: 切换大纲
 * - Alt+Left/Right: 文件导航后退/前进
 * - Ctrl+= / Ctrl+-: 字体缩放
 * - Ctrl+0: 重置字体
 */

import { StorageKeys, getString, setString } from './storage';
import { pickFolder, appendFolder } from './filetree';
import { toggleOutline } from './outline';
import { goBack, goForward } from './history';

const MIN_SCALE = 0.7;
const MAX_SCALE = 1.8;
const STEP = 0.1;

export function initShortcuts(): void {
  // 恢复上次缩放
  const saved = parseFloat(getString(StorageKeys.FONT_SCALE, '1'));
  if (saved >= MIN_SCALE && saved <= MAX_SCALE) {
    document.documentElement.style.setProperty('--font-scale', String(saved));
  }

  // 恢复侧边栏状态
  const sidebarVisible = getString(StorageKeys.SIDEBAR_VISIBLE, 'true');
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebarVisible === 'false') {
    sidebar.style.display = 'none';
  }

  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const tag = (e.target as HTMLElement)?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

    // Ctrl+O: 直接打开文件夹选择对话框
    if (ctrl && e.key === 'o' && !e.shiftKey) {
      e.preventDefault();
      handleOpenFolder();
      return;
    }

    // Ctrl+Shift+O: 切换大纲
    if (ctrl && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
      e.preventDefault();
      toggleOutline();
      return;
    }

    // Ctrl+B: 切换侧边栏 (持久化)
    if (ctrl && e.key === 'b') {
      e.preventDefault();
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        const willShow = sidebar.style.display === 'none';
        sidebar.style.display = willShow ? 'flex' : 'none';
        setString(StorageKeys.SIDEBAR_VISIBLE, String(willShow));
      }
      return;
    }

    // 字体缩放 (全局)
    if (ctrl && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      zoom(1);
      return;
    }
    if (ctrl && e.key === '-') {
      e.preventDefault();
      zoom(-1);
      return;
    }
    if (ctrl && e.key === '0') {
      e.preventDefault();
      resetZoom();
      return;
    }

    // 导航类快捷键 (输入框中不生效)
    if (inInput) return;

    // Alt+Left: 后退
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      goBack();
      return;
    }

    // Alt+Right: 前进
    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      goForward();
      return;
    }
  });
}

/**
 * 异步打开文件夹选择对话框 (供 Ctrl+O 调用)
 */
async function handleOpenFolder(): Promise<void> {
  const folderPath = await pickFolder();
  if (folderPath) {
    const fileTree = document.getElementById('file-tree');
    if (fileTree) {
      await appendFolder(fileTree, folderPath);
    }
  }
}

function zoom(direction: number): void {
  const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-scale') || '1');
  let next = current + direction * STEP;
  next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
  next = Math.round(next * 10) / 10;
  document.documentElement.style.setProperty('--font-scale', String(next));
  setString(StorageKeys.FONT_SCALE, String(next));
}

function resetZoom(): void {
  document.documentElement.style.setProperty('--font-scale', '1');
  setString(StorageKeys.FONT_SCALE, '1');
}
