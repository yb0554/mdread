/**
 * mdread 最近文件
 * - 默认只显示最近 1 个, 其余折叠
 * - 支持清空全部 + 单项移除
 */

const RECENT_KEY = 'mdread-recent-files';
const MAX_RECENT = 10;

let onOpenCallback: ((path: string) => void) | null = null;
let expanded = false;

export function initRecent(onOpen: (path: string) => void): void {
  onOpenCallback = onOpen;
  renderRecent();
}

export function addRecent(path: string): void {
  let recent = getRecent();
  recent = recent.filter(f => f !== path);
  recent.unshift(path);
  recent = recent.slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  expanded = false;
  renderRecent();
}

export function removeRecent(path: string): void {
  let recent = getRecent().filter(f => f !== path);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  renderRecent();
}

export function clearRecent(): void {
  localStorage.removeItem(RECENT_KEY);
  expanded = false;
  renderRecent();
}

function getRecent(): string[] {
  try {
    const data = localStorage.getItem(RECENT_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function renderRecent(): void {
  const container = document.getElementById('recent-files');
  if (!container) return;

  const recent = getRecent();
  if (recent.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = '';

  // 头部: 标题 + 清空按钮
  const header = document.createElement('div');
  header.className = 'recent-header';

  const title = document.createElement('span');
  title.textContent = '最近打开';
  header.appendChild(title);

  const clearBtn = document.createElement('span');
  clearBtn.className = 'recent-clear-btn';
  clearBtn.textContent = '清空';
  clearBtn.title = '清空最近文件';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearRecent();
  });
  header.appendChild(clearBtn);
  container.appendChild(header);

  // 决定显示数量: 折叠时只显示 1 个, 展开时全部
  const showCount = expanded ? recent.length : 1;

  for (let i = 0; i < showCount && i < recent.length; i++) {
    const path = recent[i];
    const item = document.createElement('div');
    item.className = 'recent-item';

    const icon = document.createElement('span');
    icon.className = 'recent-icon';
    icon.textContent = '📄';

    const label = document.createElement('span');
    label.className = 'recent-label';
    label.textContent = path.split(/[\\/]/).pop() || path;
    label.title = path;

    const removeBtn = document.createElement('span');
    removeBtn.className = 'recent-remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = '移除';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeRecent(path);
    });

    item.appendChild(icon);
    item.appendChild(label);
    item.appendChild(removeBtn);

    item.addEventListener('click', () => {
      if (onOpenCallback) onOpenCallback(path);
    });

    container.appendChild(item);
  }

  // 如果有更多项, 显示展开/收起按钮
  if (recent.length > 1) {
    const toggle = document.createElement('div');
    toggle.className = 'recent-toggle';
    toggle.textContent = expanded ? '收起 ▲' : `还有 ${recent.length - 1} 个 ▼`;
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      renderRecent();
    });
    container.appendChild(toggle);
  }
}
