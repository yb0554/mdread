/** Debounced workspace search. Prefix with `content:` to scan Markdown contents. */

import { searchWorkspaces } from './filetree';

let debounceTimer: number | null = null;

function parseQuery(value: string): { query: string; mode: 'filename' | 'content' } {
  const contentQuery = value.match(/^content:\s*(.*)$/i);
  return contentQuery
    ? { query: contentQuery[1], mode: 'content' }
    : { query: value, mode: 'filename' };
}

export function initSearch(): void {
  const input = document.getElementById('file-search') as HTMLInputElement | null;
  if (!input) return;
  input.title = '按文件名搜索；输入 content: 关键词 可扫描 Markdown 正文';
  input.addEventListener('input', () => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      const { query, mode } = parseQuery(input.value);
      void searchWorkspaces(query, mode);
      debounceTimer = null;
    }, 250);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      void searchWorkspaces('');
      input.blur();
    }
  });
}
