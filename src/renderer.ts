/**
 * mdread Markdown 渲染器
 * - 调用 Rust IPC 读取文件 (支持 GBK 编码回退)
 * - 使用 marked 解析为 HTML (含语法高亮)
 * - 本地图片路径自动转换为 asset 协议 URL
 * - 使用 DOMPurify 净化 HTML (防止 XSS/CSS 注入)
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

// 当前文件所在目录 — 用于解析相对图片路径
let currentFileDir: string | null = null;

// 配置 marked: GitHub 风格 Markdown + 语法高亮
marked.setOptions({
  gfm: true,
  breaks: true,
});

// 语法高亮扩展
marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
}));

// 图片路径解析扩展 — 将相对路径转为 asset 协议 URL
marked.use({
  renderer: {
    image({ href, title, text }: { href: string; title: string | null; text: string }): string {
      let src = href;
      // 绝对 URL 原样使用
      if (!/^(https?:|data:|asset:|blob:)/i.test(href) && currentFileDir) {
        // 相对路径 → 拼接为绝对路径 → convertFileSrc 转换
        const fullPath = currentFileDir + '/' + href;
        src = convertFileSrc(fullPath);
      }
      const titleAttr = title ? ` title="${title}"` : '';
      return `<img src="${src}" alt="${text}"${titleAttr} />`;
    },
  },
});

// 渲染完成回调 — 供 outline 模块注册
let onRenderedCallback: (() => void) | null = null;

export function onContentRendered(callback: () => void): void {
  onRenderedCallback = callback;
}

/**
 * 加载并渲染 Markdown 文件
 */
export async function loadFile(filePath: string): Promise<void> {
  const contentEl = document.getElementById('markdown-content')!;
  const emptyEl = document.getElementById('empty-state')!;

  // 记录当前文件目录 (用于图片路径解析)
  currentFileDir = filePath.replace(/[\\/][^\\/]+$/, '');

  showLoading(emptyEl, contentEl);

  try {
    const content = await invoke<string>('read_file', { path: filePath });

    // 渲染 Markdown 为 HTML (含语法高亮 + 图片路径转换)
    const rawHtml = marked.parse(content) as string;

    // 净化 HTML — 纵深防御
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      FORBID_TAGS: ['style', 'script', 'iframe', 'form'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
    });

    contentEl.innerHTML = cleanHtml;
    emptyEl.style.display = 'none';
    contentEl.classList.remove('hidden');

    document.getElementById('content')!.scrollTop = 0;

    if (onRenderedCallback) onRenderedCallback();
  } catch (err) {
    showError(emptyEl, contentEl, String(err));
    if (onRenderedCallback) onRenderedCallback();
  }
}

function showLoading(emptyEl: HTMLElement, contentEl: HTMLElement): void {
  emptyEl.style.display = 'flex';
  emptyEl.innerHTML = `
    <div class="empty-icon">⏳</div>
    <p class="empty-title">正在加载...</p>
  `;
  contentEl.classList.add('hidden');
}

function showError(emptyEl: HTMLElement, contentEl: HTMLElement, message: string): void {
  emptyEl.style.display = 'flex';
  emptyEl.innerHTML = `
    <div class="empty-icon">⚠️</div>
    <p class="empty-title">无法加载文件</p>
    <p class="empty-hint"></p>
  `;
  const hintEl = emptyEl.querySelector('.empty-hint');
  if (hintEl) {
    hintEl.textContent = message;
  }
  contentEl.classList.add('hidden');
}
