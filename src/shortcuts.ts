/**
 * mdread 键盘快捷键 + 字体缩放
 * - Ctrl+O: 打开文件夹
 * - Ctrl+B: 切换侧边栏
 * - Ctrl+Shift+O: 切换大纲
 * - Ctrl+= / Ctrl+-: 字体缩放
 * - Ctrl+0: 重置字体
 */

const SCALE_KEY = 'mdread-font-scale';
const MIN_SCALE = 0.7;
const MAX_SCALE = 1.8;
const STEP = 0.1;

export function initShortcuts(): void {
  // 恢复上次缩放
  const saved = parseFloat(localStorage.getItem(SCALE_KEY) || '1');
  if (saved >= MIN_SCALE && saved <= MAX_SCALE) {
    document.documentElement.style.setProperty('--font-scale', String(saved));
  }

  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const tag = (e.target as HTMLElement)?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

    // Ctrl+O: 打开文件夹 (通过菜单按钮触发)
    if (ctrl && e.key === 'o' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('menu-btn')?.click();
      return;
    }

    // Ctrl+Shift+O: 切换大纲
    if (ctrl && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
      e.preventDefault();
      const outline = document.getElementById('outline');
      if (outline) {
        outline.classList.toggle('hidden');
        localStorage.setItem('mdread-outline-visible', String(!outline.classList.contains('hidden')));
      }
      return;
    }

    // Ctrl+B: 切换侧边栏
    if (ctrl && e.key === 'b') {
      e.preventDefault();
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        sidebar.style.display = sidebar.style.display === 'none' ? 'flex' : 'none';
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
  });
}

function zoom(direction: number): void {
  const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-scale') || '1');
  let next = current + direction * STEP;
  next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
  next = Math.round(next * 10) / 10;
  document.documentElement.style.setProperty('--font-scale', String(next));
  localStorage.setItem(SCALE_KEY, String(next));
}

function resetZoom(): void {
  document.documentElement.style.setProperty('--font-scale', '1');
  localStorage.setItem(SCALE_KEY, '1');
}
