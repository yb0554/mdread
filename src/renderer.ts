/**
 * mdread Markdown 渲染器
 * - 调用 Rust IPC 读取文件 (支持 GBK 编码回退)
 * - 使用 marked 解析为 HTML (含语法高亮)
 * - 本地图片路径自动转换为 asset 协议 URL
 * - 使用 DOMPurify 净化 HTML (防止 XSS/CSS 注入)
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
// 使用 highlight.js 的 common 语言子集 (~35 种常用语言), 已是精简版非全量引入
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

// 当前文件路径 — 用于文件监听匹配
let currentFilePath: string | null = null;

// 当前文件所在目录 — 用于解析相对图片路径
let currentFileDir: string | null = null;

// 大文档阈值 — 超过此大小延迟渲染以先更新 UI 状态
const LARGE_FILE_THRESHOLD = 500 * 1024;

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

// HTML 属性转义 — 防止图片 src/alt/title 中的特殊字符注入
function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 路径规范化 — 消除 .. 穿越, 防止路径遍历攻击
function normalizePath(base: string, relative: string): string {
  const combined = (base + '/' + relative).replace(/\\/g, '/');
  const parts = combined.split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      result.pop();
    } else if (part !== '.' && part !== '') {
      result.push(part);
    }
  }
  return result.join('/');
}

// 图片路径解析扩展 — 将相对路径转为 asset 协议 URL
marked.use({
  renderer: {
    image({ href, title, text }: { href: string; title: string | null; text: string }): string {
      let src = href;
      // 绝对 URL 原样使用
      if (!/^(https?:|data:|asset:|blob:)/i.test(href) && currentFileDir) {
        // 相对路径 → 规范化 (消除 .. 穿越) → convertFileSrc 转换
        const fullPath = normalizePath(currentFileDir, href);
        src = convertFileSrc(fullPath);
      }
      // 转义所有属性值, 防止属性注入
      const escapedSrc = escapeHtmlAttr(src);
      const escapedAlt = escapeHtmlAttr(text);
      const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : '';
      return `<img src="${escapedSrc}" alt="${escapedAlt}"${titleAttr} />`;
    },
  },
});

// 渲染完成回调 — 供 outline 模块注册
let onRenderedCallback: (() => void) | null = null;

export function onContentRendered(callback: () => void): void {
  onRenderedCallback = callback;
}

// 文件变更监听 — 初始化一次, 匹配当前文件路径后静默重载
let watcherInitialized = false;

function initFileWatcher(): void {
  if (watcherInitialized) return;
  watcherInitialized = true;
  listen<string>('file-changed', (event) => {
    if (event.payload === currentFilePath) {
      silentReload();
    }
  }).catch(() => {
    watcherInitialized = false;
  });
}

/**
 * 静默重载当前文件 — 文件被外部编辑器修改时自动调用
 * 不显示加载状态, 保留滚动位置
 */
async function silentReload(): Promise<void> {
  if (!currentFilePath) return;
  try {
    const content = await invoke<string>('read_file', { path: currentFilePath });
    const parsed = marked.parse(content);
    const rawHtml = typeof parsed === 'string' ? parsed : await parsed;
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      FORBID_TAGS: ['style', 'script', 'iframe', 'form'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'colspan', 'rowspan', 'target', 'rel', 'type', 'checked', 'disabled', 'start', 'reversed', 'value', 'align', 'width', 'height'],
      ALLOW_DATA_ATTR: true,
    });
    const contentEl = document.getElementById('markdown-content')!;
    contentEl.innerHTML = cleanHtml;
    if (onRenderedCallback) onRenderedCallback();
  } catch {
    // 静默忽略重载错误
  }
}

/**
 * 加载并渲染 Markdown 文件
 */
export async function loadFile(filePath: string): Promise<void> {
  const contentEl = document.getElementById('markdown-content')!;
  const emptyEl = document.getElementById('empty-state')!;

  // 记录当前文件路径和目录
  currentFilePath = filePath;
  currentFileDir = filePath.replace(/[\\/][^\\/]+$/, '');

  showLoading(emptyEl, contentEl);

  // 启动文件监听 (首次调用时初始化事件监听器)
  initFileWatcher();
  invoke('watch_file', { path: filePath }).catch(() => { /* 监听失败静默降级 */ });

  try {
    const content = await invoke<string>('read_file', { path: filePath });

    // 大文档: 延迟渲染让 UI 先更新加载状态
    if (content.length > LARGE_FILE_THRESHOLD) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // 渲染 Markdown 为 HTML (含语法高亮 + 图片路径转换)
    // 使用 typeof 守卫兼容 marked 的 sync/async 两种返回类型
    const parsed = marked.parse(content);
    const rawHtml = typeof parsed === 'string' ? parsed : await parsed;

    // 净化 HTML — 白名单模式 (比黑名单更安全)
    // DOMPurify 默认已移除所有 on* 事件属性, 无需显式 FORBID_ATTR
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      FORBID_TAGS: ['style', 'script', 'iframe', 'form'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'colspan', 'rowspan', 'target', 'rel', 'type', 'checked', 'disabled', 'start', 'reversed', 'value', 'align', 'width', 'height'],
      ALLOW_DATA_ATTR: true,
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
