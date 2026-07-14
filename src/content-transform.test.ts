import { describe, expect, it } from 'vitest';
import { resolveLocalAsset, sanitizeAndTransformMarkdown } from './content-transform';

const options = {
  documentPath: 'C:\\docs\\guide\\README.md',
  allowRemoteImages: false,
  assetUrl: (path: string) => `asset://localhost/${path.replace(/\\/g, '/')}`,
};

describe('sanitizeAndTransformMarkdown', () => {
  it('resolves local images through the approved asset resolver', () => {
    const html = sanitizeAndTransformMarkdown('<img src="images/logo.png" alt="logo">', options);
    expect(html).toContain('asset://localhost/C:/docs/guide/images/logo.png');
    expect(html).toContain('alt="logo"');
  });

  it('blocks remote images and unsafe links by default', () => {
    const html = sanitizeAndTransformMarkdown(
      '<img src="https://example.com/a.png"><a href="file:///secret">secret</a><a href="javascript:alert(1)">bad</a>',
      options,
    );
    expect(html).toContain('已阻止远程图片：https://example.com/a.png');
    expect(html).toContain('unsafe-link');
    expect(html).not.toContain('file:///secret');
    expect(html).not.toContain('javascript:');
  });

  it('retains internal anchors and configures allowed external links', () => {
    const html = sanitizeAndTransformMarkdown('<a href="#section">目录</a><a href="https://example.com">外部</a>', options);
    expect(html).toContain('href="#section"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('allows remote images only after explicit session approval', () => {
    const html = sanitizeAndTransformMarkdown('<img src="https://example.com/a.png">', { ...options, allowRemoteImages: true });
    expect(html).toContain('src="https://example.com/a.png"');
  });
});

it('resolves a relative path from the document directory', () => {
  expect(resolveLocalAsset('C:\\docs\\guide\\README.md', './images/logo.png')).toBe('C:\\docs\\guide\\images/logo.png');
});
