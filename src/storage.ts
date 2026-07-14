/** Local persistence with a recoverable v2 schema. */

export const StorageKeys = {
  APP_STATE: 'mdread-state-v2',
  FOLDERS: 'mdread-folders',
  LEGACY_FOLDER: 'mdread-last-folder',
  THEME: 'mdread-theme',
  FONT_STYLE: 'mdread-font-style',
  FONT_SCALE: 'mdread-font-scale',
  OUTLINE_VISIBLE: 'mdread-outline-visible',
  SIDEBAR_VISIBLE: 'mdread-sidebar-visible',
  SIDEBAR_WIDTH: 'mdread-sidebar-width',
  RECENT_FILES: 'mdread-recent-files',
  FAVORITES: 'mdread-favorites',
  LAST_DOCUMENT: 'mdread-last-document',
  REMOTE_IMAGES: 'mdread-remote-images',
} as const;

export interface AppState {
  schemaVersion: 2;
  lastDocument?: string;
  favorites: string[];
  sidebarWidth?: number;
  allowRemoteImages: boolean;
}

const defaultState = (): AppState => ({
  schemaVersion: 2,
  favorites: [],
  allowRemoteImages: false,
});

function safely<T>(fallback: T, operation: () => T): T {
  try {
    return operation();
  } catch {
    return fallback;
  }
}

export function getString(key: string, fallback = ''): string {
  return safely(fallback, () => localStorage.getItem(key) ?? fallback);
}

export function setString(key: string, value: string): void {
  safely(undefined, () => localStorage.setItem(key, value));
}

export function getJSON<T>(key: string, fallback: T): T {
  return safely(fallback, () => {
    const data = localStorage.getItem(key);
    return data ? (JSON.parse(data) as T) : fallback;
  });
}

export function setJSON(key: string, value: unknown): void {
  safely(undefined, () => localStorage.setItem(key, JSON.stringify(value)));
}

export function remove(key: string): void {
  safely(undefined, () => localStorage.removeItem(key));
}

export function getAppState(): AppState {
  const saved = getJSON<Partial<AppState> | null>(StorageKeys.APP_STATE, null);
  if (saved?.schemaVersion === 2) {
    return {
      ...defaultState(),
      ...saved,
      favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
      allowRemoteImages: saved.allowRemoteImages === true,
    };
  }

  const migrated: AppState = {
    ...defaultState(),
    lastDocument: getString(StorageKeys.LAST_DOCUMENT) || undefined,
    favorites: getJSON<string[]>(StorageKeys.FAVORITES, []),
    sidebarWidth: Number(getString(StorageKeys.SIDEBAR_WIDTH)) || undefined,
    allowRemoteImages: getString(StorageKeys.REMOTE_IMAGES) === 'true',
  };
  setAppState(migrated);
  return migrated;
}

export function setAppState(next: AppState): void {
  setJSON(StorageKeys.APP_STATE, { ...next, schemaVersion: 2 });
}

export function updateAppState(update: Partial<Omit<AppState, 'schemaVersion'>>): AppState {
  const next = { ...getAppState(), ...update, schemaVersion: 2 as const };
  setAppState(next);
  return next;
}
