import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addRecent, initRecent, removeRecent } from './recent';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="recent-files"></div>';
});

describe('recent documents', () => {
  it('uses distinct accessible buttons to open and remove a file', () => {
    const onOpen = vi.fn();
    initRecent(onOpen);
    addRecent('C:/docs/long-markdown-file.md');

    const open = document.querySelector<HTMLButtonElement>('.recent-open-btn');
    const remove = document.querySelector<HTMLButtonElement>('.recent-remove-btn');
    expect(open?.getAttribute('aria-label')).toContain('打开最近文件');
    expect(remove?.getAttribute('aria-label')).toContain('移除');
    open?.click();
    expect(onOpen).toHaveBeenCalledWith('C:/docs/long-markdown-file.md');
    remove?.click();
    expect(document.querySelector('.recent-open-btn')).toBeNull();
  });

  it('keeps remaining recent records after an item is removed', () => {
    initRecent(vi.fn());
    addRecent('C:/docs/a.md');
    addRecent('C:/docs/b.markdown');
    removeRecent('C:/docs/b.markdown');
    expect(document.querySelector('.recent-label')?.textContent).toBe('a.md');
  });
});
