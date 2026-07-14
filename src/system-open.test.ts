import { describe, expect, it } from 'vitest';
import { selectMarkdownPath } from './system-open';

describe('selectMarkdownPath', () => {
  it('selects the first supported Markdown path', () => {
    expect(selectMarkdownPath(['C:/notes/readme.txt', ' C:/notes/guide.MD '])).toBe('C:/notes/guide.MD');
  });

  it('supports only the registered Markdown extensions', () => {
    expect(selectMarkdownPath(['a.markdown'])).toBe('a.markdown');
    expect(selectMarkdownPath(['a.mdown'])).toBeNull();
    expect(selectMarkdownPath(['a.mkdn'])).toBeNull();
    expect(selectMarkdownPath(['a.mdx'])).toBeNull();
  });

  it('rejects a missing or unsupported payload', () => {
    expect(selectMarkdownPath(undefined)).toBeNull();
    expect(selectMarkdownPath(['', 'C:/notes/file.exe'])).toBeNull();
  });
});
