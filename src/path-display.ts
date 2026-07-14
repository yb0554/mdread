/** Human-readable paths for the interface; native paths remain untouched for IPC. */
export function formatDisplayPath(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return path.replace(/^\\\\\?\\UNC\\/i, '\\\\');
  return path.replace(/^\\\\\?\\/, '');
}
