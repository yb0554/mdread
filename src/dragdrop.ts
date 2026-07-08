/**
 * mdread 拖拽打开
 * 监听 Tauri 拖拽事件, 支持 .md/.markdown 文件拖入窗口直接打开
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';

let onDropCallback: ((path: string) => void) | null = null;
const unlistenFns: UnlistenFn[] = [];

export async function initDragDrop(onDrop: (path: string) => void): Promise<void> {
  onDropCallback = onDrop;

  try {
    const unlistenDrop = await listen<{ paths: string[]; type: string }>('tauri://drag-drop', (event) => {
      const payload = event.payload;
      if (payload.paths && Array.isArray(payload.paths)) {
        for (const path of payload.paths) {
          const ext = path.toLowerCase().split('.').pop();
          if (ext === 'md' || ext === 'markdown') {
            if (onDropCallback) {
              onDropCallback(path);
            }
            break; // 只打开第一个 .md 文件
          }
        }
      }
    });
    unlistenFns.push(unlistenDrop);
  } catch {
    // 拖拽事件不可用时静默降级
    console.warn('拖拽事件不可用');
  }

  // 视觉反馈
  try {
    const unlistenEnter = await listen('tauri://drag-enter', () => {
      document.getElementById('content')?.classList.add('drag-over');
    });
    unlistenFns.push(unlistenEnter);
    const unlistenLeave = await listen('tauri://drag-leave', () => {
      document.getElementById('content')?.classList.remove('drag-over');
    });
    unlistenFns.push(unlistenLeave);
  } catch {
    // 忽略
  }
}

/**
 * 清理所有拖拽事件监听器 — 供应用卸载时调用
 */
export function cleanupDragDrop(): void {
  for (const unlisten of unlistenFns) {
    unlisten();
  }
  unlistenFns.length = 0;
}
