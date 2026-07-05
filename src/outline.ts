/**
 * mdread 文档大纲模块
 * - 从渲染后的 HTML 提取标题层级
 * - 右侧面板显示目录树
 * - 点击跳转 + 滚动高亮 (IntersectionObserver)
 * - 代码块复制按钮
 * - 阅读进度条
 */

import { onContentRendered } from './renderer';

// 模块级状态
let scrollSpy: IntersectionObserver | null = null;
let progressRaf: number | null = null;
const OUTLINE_KEY = 'mdread-outline-visible';

/**
 * 初始化大纲模块 — 在 main.ts DOMContentLoaded 中调用
 */
export function initOutline(): void {
  // 注册渲染完成回调
  onContentRendered(buildOutline);

  // 绑定关闭按钮
  const closeBtn = document.getElementById('outline-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => toggleOutline(false));
  }

  // 恢复持久化状态
  const visible = localStorage.getItem(OUTLINE_KEY);
  if (visible === 'true') {
    const panel = document.getElementById('outline');
    if (panel) {
      panel.classList.remove('hidden');
    }
  }

  // 阅读进度条
  const content = document.getElementById('content');
  if (content) {
    content.addEventListener('scroll', () => {
      if (progressRaf !== null) return;
      progressRaf = requestAnimationFrame(() => {
        updateReadingProgress();
        progressRaf = null;
      });
    });
  }
}

/**
 * 构建大纲 — 渲染完成后自动调用
 */
function buildOutline(): void {
  const contentEl = document.getElementById('markdown-content')!;
  const treeEl = document.getElementById('outline-tree')!;
  const panel = document.getElementById('outline');

  // 清理旧状态
  clearOutline();

  // 如果内容区隐藏（空/错误态），隐藏大纲
  if (contentEl.classList.contains('hidden')) {
    if (panel) panel.classList.add('hidden');
    return;
  }

  // 提取标题
  const headings = contentEl.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');

  // 短文档自动隐藏
  if (headings.length < 3) {
    if (panel) panel.classList.add('hidden');
    return;
  }

  // 分配 ID 并计算最小层级
  const minLevel = Math.min(...Array.from(headings).map(h => parseInt(h.tagName[1])));
  const fragment = document.createDocumentFragment();

  headings.forEach((heading, index) => {
    // 分配顺序化 ID
    const id = `md-toc-${index}`;
    heading.id = id;
    heading.style.scrollMarginTop = '16px';

    // 计算层级缩进
    const level = parseInt(heading.tagName[1]);
    const indent = (level - minLevel) * 14;

    // 创建大纲项
    const item = document.createElement('div');
    item.className = 'outline-item';
    item.style.paddingLeft = `${indent + 12}px`;
    item.textContent = heading.textContent || `(标题 ${index + 1})`;
    item.title = heading.textContent || '';
    item.setAttribute('data-target', id);

    // 点击跳转
    item.addEventListener('click', () => {
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    fragment.appendChild(item);
  });

  treeEl.innerHTML = '';
  treeEl.appendChild(fragment);

  // 显示大纲面板
  if (panel) {
    panel.classList.remove('hidden');
  }

  // 启动 scroll-spy
  setupScrollSpy(headings);

  // 添加代码块复制按钮
  addCopyButtons(contentEl);
}

/**
 * 设置滚动高亮 — IntersectionObserver
 */
function setupScrollSpy(headings: NodeListOf<HTMLElement>): void {
  const content = document.getElementById('content');
  if (!content) return;

  scrollSpy = new IntersectionObserver(
    (entries) => {
      // 收集当前可见的标题
      const visibleIds = new Set<string>();
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visibleIds.add(entry.target.id);
        }
      }

      if (visibleIds.size === 0) return;

      // 取文档顺序最靠前的可见标题
      let firstVisible: string | null = null;
      for (const heading of headings) {
        if (visibleIds.has(heading.id)) {
          firstVisible = heading.id;
          break;
        }
      }

      if (firstVisible) {
        // 更新高亮
        document.querySelectorAll('.outline-item.active').forEach(el => {
          el.classList.remove('active');
        });
        const activeItem = document.querySelector(`.outline-item[data-target="${firstVisible}"]`);
        if (activeItem) {
          activeItem.classList.add('active');
          // 滚动大纲到可见区域
          const treeEl = document.getElementById('outline-tree');
          if (treeEl) {
            const itemTop = (activeItem as HTMLElement).offsetTop;
            const treeHeight = treeEl.clientHeight;
            treeEl.scrollTop = itemTop - treeHeight / 2;
          }
        }
      }
    },
    {
      root: content,
      rootMargin: '0px 0px -75% 0px',
      threshold: 0,
    }
  );

  // 观察所有标题
  headings.forEach(heading => scrollSpy!.observe(heading));
}

/**
 * 清理大纲状态
 */
function clearOutline(): void {
  if (scrollSpy) {
    scrollSpy.disconnect();
    scrollSpy = null;
  }
  const treeEl = document.getElementById('outline-tree');
  if (treeEl) {
    treeEl.innerHTML = '';
  }
}

/**
 * 切换大纲显示/隐藏
 */
function toggleOutline(force?: boolean): void {
  const panel = document.getElementById('outline');
  if (!panel) return;

  const shouldShow = force !== undefined ? force : panel.classList.contains('hidden');

  if (shouldShow) {
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }

  localStorage.setItem(OUTLINE_KEY, String(shouldShow));
}

/**
 * 给代码块添加复制按钮
 */
function addCopyButtons(contentEl: HTMLElement): void {
  const preElements = contentEl.querySelectorAll('pre');
  preElements.forEach(pre => {
    // 跳过已有复制按钮的
    if (pre.querySelector('.copy-btn')) return;

    // 确保 pre 是 relative 定位
    (pre as HTMLElement).style.position = 'relative';

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = '复制';
    btn.title = '复制代码';

    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = '已复制';
          setTimeout(() => {
            btn.textContent = '复制';
          }, 2000);
        } catch {
          btn.textContent = '失败';
          setTimeout(() => {
            btn.textContent = '复制';
          }, 2000);
        }
      }
    });

    pre.appendChild(btn);
  });
}

/**
 * 更新阅读进度条
 */
function updateReadingProgress(): void {
  const content = document.getElementById('content');
  const progress = document.getElementById('reading-progress');
  if (!content || !progress) return;

  const max = content.scrollHeight - content.clientHeight;
  if (max <= 0) {
    progress.style.width = '0%';
    return;
  }

  const percent = (content.scrollTop / max) * 100;
  progress.style.width = `${percent}%`;
}
