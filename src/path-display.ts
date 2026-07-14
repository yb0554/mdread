/** Human-readable paths for the interface; native paths remain untouched for IPC. */
export function formatDisplayPath(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return path.replace(/^\\\\\?\\UNC\\/i, '\\\\');
  return path.replace(/^\\\\\?\\/, '');
}

/** Return a concise file name for UI labels while retaining the original path for IPC. */
export function getPathFileName(path: string): string {
  const displayPath = formatDisplayPath(path).replace(/[\\/]+$/, '');
  return displayPath.split(/[\\/]/).filter(Boolean).pop() || displayPath;
}
