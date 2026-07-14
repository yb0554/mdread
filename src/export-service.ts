/** Cross-platform print entry point shared by menu and keyboard shortcuts. */

export function exportToPdf(): void {
  const content = document.getElementById('markdown-content');
  if (!content || content.classList.contains('hidden') || !content.textContent?.trim()) return;
  window.print();
}
