import { beforeEach, describe, expect, it } from 'vitest';
import { getAppState, getJSON, StorageKeys, updateAppState } from './storage';

describe('recoverable application storage', () => {
  beforeEach(() => localStorage.clear());

  it('migrates legacy preferences into the versioned state', () => {
    localStorage.setItem(StorageKeys.LAST_DOCUMENT, 'C:\\docs\\guide.md');
    localStorage.setItem(StorageKeys.FAVORITES, JSON.stringify(['C:\\docs\\guide.md']));
    localStorage.setItem(StorageKeys.SIDEBAR_WIDTH, '320');
    localStorage.setItem(StorageKeys.REMOTE_IMAGES, 'true');

    expect(getAppState()).toEqual({
      schemaVersion: 2,
      lastDocument: 'C:\\docs\\guide.md',
      favorites: ['C:\\docs\\guide.md'],
      sidebarWidth: 320,
      allowRemoteImages: true,
    });
  });

  it('falls back safely when persisted JSON is corrupted', () => {
    localStorage.setItem(StorageKeys.APP_STATE, '{not-json');

    expect(getAppState()).toEqual({
      schemaVersion: 2,
      favorites: [],
      allowRemoteImages: false,
      lastDocument: undefined,
      sidebarWidth: undefined,
    });
    expect(getJSON('missing', ['fallback'])).toEqual(['fallback']);
  });

  it('merges state updates without discarding existing preferences', () => {
    updateAppState({ favorites: ['C:\\docs\\guide.md'] });
    const next = updateAppState({ lastDocument: 'C:\\docs\\guide.md', allowRemoteImages: true });

    expect(next).toEqual({
      schemaVersion: 2,
      favorites: ['C:\\docs\\guide.md'],
      lastDocument: 'C:\\docs\\guide.md',
      allowRemoteImages: true,
    });
  });
});
