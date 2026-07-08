/**
 * mdread 统一存储管理
 * 集中管理所有 localStorage 键名和读写操作
 * 避免键名散落各模块导致的迁移遗漏问题
 */

export const StorageKeys = {
  FOLDERS: 'mdread-folders',
  LEGACY_FOLDER: 'mdread-last-folder',
  THEME: 'mdread-theme',
  FONT_STYLE: 'mdread-font-style',
  FONT_SCALE: 'mdread-font-scale',
  OUTLINE_VISIBLE: 'mdread-outline-visible',
  SIDEBAR_VISIBLE: 'mdread-sidebar-visible',
  RECENT_FILES: 'mdread-recent-files',
} as const;

/** 读取原始字符串值（非 JSON） */
export function getString(key: string, fallback: string = ''): string {
  return localStorage.getItem(key) ?? fallback;
}

/** 写入原始字符串值（非 JSON） */
export function setString(key: string, value: string): void {
  localStorage.setItem(key, value);
}

/** 读取 JSON 值，解析失败返回 fallback */
export function getJSON<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) as T : fallback;
  } catch {
    return fallback;
  }
}

/** 写入 JSON 值 */
export function setJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/** 移除指定键 */
export function remove(key: string): void {
  localStorage.removeItem(key);
}
