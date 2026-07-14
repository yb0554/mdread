import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addRecent, initRecent, removeRecent } from './recent';

const extendedChinesePath = String.raw`\\?\D:\文件路径\项目说明.markdown`;
const displayedChinesePath = String.raw`D:\文件路径\项目说明.markdown`;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="recent-files"></div>';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
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

  it('uses only a concise file name for extended Windows paths', () => {
    initRecent(vi.fn());
    addRecent(extendedChinesePath);
    expect(document.querySelector('.recent-label')?.textContent).toBe('项目说明.markdown');
    expect(document.querySelector('.recent-label')?.getAttribute('title')).toBe(displayedChinesePath);
  });

  it('offers the normalized full path through the recent item context menu', () => {
    initRecent(vi.fn());
    const path = String.raw`\\?\D:\文件路径\项目说明.md`;
    const displayedPath = String.raw`D:\文件路径\项目说明.md`;
    addRecent(path);
    const open = document.querySelector<HTMLButtonElement>('.recent-open-btn');
    open?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 30 }));

    const copy = document.querySelector<HTMLButtonElement>('.recent-context-menu-item');
    expect(copy?.textContent).toBe('复制完整路径');
    copy?.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(displayedPath);
  });

  it('keeps remaining recent records after an item is removed', () => {
    initRecent(vi.fn());
    addRecent('C:/docs/a.md');
    addRecent('C:/docs/b.markdown');
    removeRecent('C:/docs/b.markdown');
    expect(document.querySelector('.recent-label')?.textContent).toBe('a.md');
  });
});
