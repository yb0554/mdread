/** Accessible outline, code copying and reading progress. */

import { onContentRendered } from './renderer';
import { getString, setString, StorageKeys } from './storage';

let scrollSpy: IntersectionObserver | null = null;
let progressRaf: number | null = null;
let cancelScheduledBuild: (() => void) | null = null;
let outlineInitialized = false;
let outlineBuildRequest = 0;
let hasOutline = false;
let mobileDrawerOpen = false;

const narrowLayout = window.matchMedia('(max-width: 960px)');

type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };
type IdleWindow = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function scheduleIdle(callback: (deadline: IdleDeadlineLike) => void): () => void {
  const idleWindow = window as IdleWindow;
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 450 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 0);
  return () => window.clearTimeout(handle);
}

function wantsOutline(): boolean {
  return getString(StorageKeys.OUTLINE_VISIBLE, 'true') !== 'false';
}

function syncOutlineVisibility(): void {
  const panel = document.getElementById('outline');
  const toggle = document.getElementById('outline-toggle') as HTMLButtonElement | null;
  if (!panel || !toggle) return;

  const narrow = narrowLayout.matches;
  const visible = hasOutline && (narrow ? mobileDrawerOpen : wantsOutline());
  panel.classList.toggle('hidden', !visible);
  panel.toggleAttribute('data-drawer', narrow);
  if (narrow) {
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '文档目录');
  } else {
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
  }
  toggle.hidden = !hasOutline || !narrow;
  toggle.setAttribute('aria-expanded', String(visible));
}

function closeOutlineAndRestoreFocus(): void {
  toggleOutline(false);
  if (narrowLayout.matches) document.getElementById('outline-toggle')?.focus();
}

export function initOutline(): void {
  if (outlineInitialized) return;
  outlineInitialized = true;

  const content = document.getElementById('content');
  const close = document.getElementById('outline-close');
  const toggle = document.getElementById('outline-toggle');
  const tree = document.getElementById('outline-tree');
  close?.addEventListener('click', closeOutlineAndRestoreFocus);
  toggle?.addEventListener('click', () => toggleOutline());
  content?.addEventListener('scroll', () => {
    if (progressRaf !== null) return;
    progressRaf = requestAnimationFrame(() => {
      progressRaf = null;
      updateReadingProgress();
    });
  }, { passive: true });
  tree?.addEventListener('keydown', (event) => {
    const active = document.activeElement as HTMLButtonElement | null;
    if (!active?.matches('.outline-item')) return;
    const items = [...tree.querySelectorAll<HTMLButtonElement>('.outline-item')];
    const index = items.indexOf(active);
    if (index < 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1)
        : event.key === 'ArrowUp' ? Math.max(0, index - 1)
          : event.key === 'Home' ? 0 : items.length - 1;
      items[next]?.focus();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && narrowLayout.matches && mobileDrawerOpen) closeOutlineAndRestoreFocus();
  });
  narrowLayout.addEventListener('change', (event) => {
    if (event.matches) mobileDrawerOpen = false;
    syncOutlineVisibility();
  });
  onContentRendered(scheduleOutlineBuild);
  syncOutlineVisibility();
}

function scheduleOutlineBuild(): void {
  outlineBuildRequest += 1;
  const requestId = outlineBuildRequest;
  cancelScheduledBuild?.();
  clearOutline();
  hasOutline = false;
  syncOutlineVisibility();

  const content = document.getElementById('markdown-content');
  const tree = document.getElementById('outline-tree');
  if (content?.dataset.largeDocument === 'true' && tree && wantsOutline()) tree.textContent = '正在延迟构建大文档目录…';
  cancelScheduledBuild = scheduleIdle(() => {
    cancelScheduledBuild = null;
    if (requestId === outlineBuildRequest) buildOutline(requestId);
  });
}

function buildOutline(requestId: number): void {
  if (requestId !== outlineBuildRequest) return;
  const content = document.getElementById('markdown-content');
  const tree = document.getElementById('outline-tree');
  if (!content || !tree) return;

  addCopyButtons(content);
  updateReadingProgress();
  if (content.classList.contains('hidden')) {
    hasOutline = false;
    syncOutlineVisibility();
    return;
  }

  const headings = content.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
  if (headings.length < 3) {
    hasOutline = false;
    syncOutlineVisibility();
    return;
  }

  const usedIds = new Map<string, number>();
  const minLevel = Math.min(...Array.from(headings, (heading) => Number(heading.tagName[1])));
  const fragment = document.createDocumentFragment();
  headings.forEach((heading, index) => {
    const base = slugify(heading.textContent || `section-${index + 1}`);
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    heading.id = id;
    heading.style.scrollMarginTop = '16px';

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'outline-item';
    item.style.paddingLeft = `${Math.min((Number(heading.tagName[1]) - minLevel) * 14 + 12, 56)}px`;
    item.textContent = heading.textContent || `(标题 ${index + 1})`;
    item.title = heading.textContent || '';
    item.dataset.target = id;
    item.addEventListener('click', () => {
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (narrowLayout.matches) toggleOutline(false);
    });
    fragment.appendChild(item);
  });

  if (requestId !== outlineBuildRequest) return;
  tree.replaceChildren(fragment);
  hasOutline = true;
  syncOutlineVisibility();
  setupScrollSpy(headings);
}

function slugify(value: string): string {
  const normalized = value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return normalized.replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

function setupScrollSpy(headings: NodeListOf<HTMLElement>): void {
  const content = document.getElementById('content');
  if (!content) return;
  scrollSpy = new IntersectionObserver((entries) => {
    const visible = new Set(entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target.id));
    const current = Array.from(headings).find((heading) => visible.has(heading.id));
    if (!current) return;
    document.querySelectorAll('.outline-item.active').forEach((item) => item.classList.remove('active'));
    const item = document.querySelector<HTMLButtonElement>(`.outline-item[data-target="${CSS.escape(current.id)}"]`);
    if (!item) return;
    item.classList.add('active');
    const tree = document.getElementById('outline-tree');
    if (tree) tree.scrollTop = item.offsetTop - tree.clientHeight / 2;
  }, { root: content, rootMargin: '0px 0px -75% 0px', threshold: 0 });
  headings.forEach((heading) => scrollSpy?.observe(heading));
}

function clearOutline(): void {
  scrollSpy?.disconnect();
  scrollSpy = null;
  document.getElementById('outline-tree')?.replaceChildren();
}

export function toggleOutline(force?: boolean): void {
  if (narrowLayout.matches) {
    mobileDrawerOpen = force ?? !mobileDrawerOpen;
  } else {
    const show = force ?? !wantsOutline();
    setString(StorageKeys.OUTLINE_VISIBLE, String(show));
  }
  syncOutlineVisibility();
}

function addCopyButtons(content: HTMLElement): void {
  content.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
    if (pre.querySelector('.copy-btn')) return;
    pre.style.position = 'relative';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-btn';
    button.textContent = '复制';
    button.title = '复制代码';
    button.setAttribute('aria-label', '复制代码块');
    button.addEventListener('click', async () => {
      const text = pre.querySelector('code')?.textContent ?? pre.textContent;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = '已复制';
      } catch {
        button.textContent = '失败';
      }
      window.setTimeout(() => { button.textContent = '复制'; }, 1600);
    });
    pre.appendChild(button);
  });
}

function updateReadingProgress(): void {
  const content = document.getElementById('content');
  const progress = document.getElementById('reading-progress');
  if (!content || !progress) return;
  const maximum = content.scrollHeight - content.clientHeight;
  progress.style.width = maximum > 0 ? `${(content.scrollTop / maximum) * 100}%` : '0%';
}
