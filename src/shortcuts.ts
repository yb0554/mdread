import { exportToPdf } from './export-service';
import { goBack, goForward } from './history';
import { toggleOutline } from './outline';
import { getString, setString, StorageKeys } from './storage';

const MIN_SCALE = 0.7;
const MAX_SCALE = 1.8;
const STEP = 0.1;

export interface ShortcutHandlers {
  addWorkspace: () => Promise<void>;
}

export function initShortcuts(handlers: ShortcutHandlers): void {
  const savedScale = Number.parseFloat(getString(StorageKeys.FONT_SCALE, '1'));
  if (savedScale >= MIN_SCALE && savedScale <= MAX_SCALE) {
    document.documentElement.style.setProperty('--font-scale', String(savedScale));
  }
  applySidebarVisibility(getString(StorageKeys.SIDEBAR_VISIBLE, 'true') !== 'false');

  document.addEventListener('keydown', (event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    const target = event.target as HTMLElement | null;
    const inInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

    if (ctrl && event.key.toLowerCase() === 'o' && !event.shiftKey) {
      event.preventDefault();
      void handlers.addWorkspace();
      return;
    }
    if (ctrl && event.shiftKey && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      toggleOutline();
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      applySidebarVisibility(getString(StorageKeys.SIDEBAR_VISIBLE, 'true') === 'false');
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'p' && !event.shiftKey) {
      event.preventDefault();
      exportToPdf();
      return;
    }
    if (ctrl && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      zoom(1);
      return;
    }
    if (ctrl && event.key === '-') {
      event.preventDefault();
      zoom(-1);
      return;
    }
    if (ctrl && event.key === '0') {
      event.preventDefault();
      resetZoom();
      return;
    }
    if (inInput) return;
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      goBack();
    } else if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      goForward();
    }
  });
}

function applySidebarVisibility(show: boolean): void {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  if (sidebar) sidebar.hidden = !show;
  if (resizer) resizer.hidden = !show;
  setString(StorageKeys.SIDEBAR_VISIBLE, String(show));
}

function zoom(direction: number): void {
  const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-scale') || '1');
  const next = Math.round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, current + direction * STEP)) * 10) / 10;
  document.documentElement.style.setProperty('--font-scale', String(next));
  setString(StorageKeys.FONT_SCALE, String(next));
}

function resetZoom(): void {
  document.documentElement.style.setProperty('--font-scale', '1');
  setString(StorageKeys.FONT_SCALE, '1');
}
