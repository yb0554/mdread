/**
 * mdread 文件搜索过滤
 * 在侧边栏搜索框中输入关键词, 过滤已加载的文件树节点
 */

let debounceTimer: number | null = null;

export function initSearch(): void {
  const input = document.getElementById('file-search') as HTMLInputElement | null;
  if (!input) return;

  input.addEventListener('input', () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      filterTree(input.value.trim().toLowerCase());
      debounceTimer = null;
    }, 300);
  });
}

function filterTree(query: string): void {
  const fileTree = document.getElementById('file-tree');
  if (!fileTree) return;

  if (!query) {
    fileTree.querySelectorAll<HTMLElement>('.tree-node, .tree-root, .tree-children').forEach(el => {
      el.style.display = '';
    });
    return;
  }

  const roots = fileTree.querySelectorAll('.tree-root');
  roots.forEach(root => {
    const hasMatch = filterNode(root as HTMLElement, query);
    (root as HTMLElement).style.display = hasMatch ? '' : 'none';
  });
}

function filterNode(element: HTMLElement, query: string): boolean {
  let hasMatch = false;
  const children = element.children;

  for (let i = 0; i < children.length; i++) {
    const child = children[i] as HTMLElement;

    if (child.classList.contains('tree-node')) {
      const label = child.querySelector('.tree-label');
      const text = label?.textContent?.toLowerCase() || '';
      const isFile = child.classList.contains('file');

      if (isFile) {
        const match = text.includes(query);
        child.style.display = match ? '' : 'none';
        if (match) hasMatch = true;
      } else {
        // 文件夹: 递归检查子节点
        const childHasMatch = filterNode(child, query);
        child.style.display = childHasMatch ? '' : 'none';
        if (childHasMatch) hasMatch = true;
      }
    } else if (child.classList.contains('tree-children')) {
      const childHasMatch = filterNode(child, query);
      child.style.display = childHasMatch ? '' : 'none';
      if (childHasMatch) hasMatch = true;
    }
  }

  return hasMatch;
}
