import DOMPurify from 'dompurify';

export interface ContentTransformOptions {
  documentPath: string;
  allowRemoteImages: boolean;
  assetUrl: (path: string) => string;
}

export function isSafeExternalUrl(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

function documentDirectory(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, '');
}

export function resolveLocalAsset(documentPath: string, href: string): string {
  const base = documentDirectory(documentPath);
  const separator = base.includes('\\') ? '\\' : '/';
  return `${base}${separator}${href.replace(/^\.([\\/])/, '')}`;
}

function isTrustedImageSource(href: string): boolean {
  return /^(data:|asset:|blob:)/i.test(href);
}

function replaceWithNotice(element: Element, className: string, message: string): void {
  const notice = document.createElement('span');
  notice.className = className;
  notice.setAttribute('role', 'note');
  notice.textContent = message;
  element.replaceWith(notice);
}

function transformImage(image: HTMLImageElement, options: ContentTransformOptions): void {
  const href = image.getAttribute('src') || '';
  if (/^https?:/i.test(href)) {
    if (!options.allowRemoteImages) {
      replaceWithNotice(image, 'remote-image-blocked', `已阻止远程图片：${href}`);
    }
    return;
  }

  if (isTrustedImageSource(href)) return;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    replaceWithNotice(image, 'remote-image-blocked', '已阻止不安全图片协议');
    return;
  }

  image.setAttribute('src', options.assetUrl(resolveLocalAsset(options.documentPath, href)));
}

function transformLink(anchor: HTMLAnchorElement): void {
  const href = anchor.getAttribute('href') || '';
  if (href.startsWith('#')) return;
  if (isSafeExternalUrl(href)) {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
    return;
  }

  const blocked = document.createElement('span');
  blocked.className = 'unsafe-link';
  blocked.title = '已阻止不安全或本地链接';
  while (anchor.firstChild) blocked.appendChild(anchor.firstChild);
  anchor.replaceWith(blocked);
}

export function sanitizeAndTransformMarkdown(rawHtml: string, options: ContentTransformOptions): string {
  const sanitized = DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'object', 'embed'],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class', 'id', 'colspan', 'rowspan',
      'target', 'rel', 'type', 'checked', 'disabled', 'start', 'reversed',
      'value', 'align', 'width', 'height', 'aria-label', 'role',
    ],
    ALLOW_DATA_ATTR: false,
  });
  const template = document.createElement('template');
  template.innerHTML = sanitized;
  template.content.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => transformImage(image, options));
  template.content.querySelectorAll<HTMLAnchorElement>('a[href], a:not([href])').forEach(transformLink);
  return template.innerHTML;
}
