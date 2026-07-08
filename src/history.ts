/**
 * mdread 文件导航历史
 * - 维护文件访问栈, 支持 前进/后退
 * - Alt+Left: 后退
 * - Alt+Right: 前进
 * - 导航时调用 loadFile 但不 pushHistory, 避免产生新历史条目
 */

let history: string[] = [];
let currentIndex: number = -1;
let onNavigateCallback: ((path: string) => void) | null = null;

/**
 * 初始化导航历史 — 注册导航回调
 * 回调中应调用 loadFile 但不应调用 pushHistory
 */
export function initHistory(onNavigate: (path: string) => void): void {
  onNavigateCallback = onNavigate;
}

/**
 * 添加文件到历史栈
 * 若与当前文件相同则跳过; 截断前进历史
 */
export function pushHistory(path: string): void {
  if (currentIndex >= 0 && history[currentIndex] === path) return;
  history = history.slice(0, currentIndex + 1);
  history.push(path);
  currentIndex = history.length - 1;
}

/**
 * 后退到上一个文件
 */
export function goBack(): void {
  if (currentIndex > 0) {
    currentIndex--;
    if (onNavigateCallback && history[currentIndex]) {
      onNavigateCallback(history[currentIndex]);
    }
  }
}

/**
 * 前进到下一个文件
 */
export function goForward(): void {
  if (currentIndex < history.length - 1) {
    currentIndex++;
    if (onNavigateCallback && history[currentIndex]) {
      onNavigateCallback(history[currentIndex]);
    }
  }
}

export function canGoBack(): boolean {
  return currentIndex > 0;
}

export function canGoForward(): boolean {
  return currentIndex < history.length - 1;
}
