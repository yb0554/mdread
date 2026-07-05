/**
 * mdread 主题 + 字体模板管理器
 * 5 套颜色主题 + 4 套字体样式
 */

export type ThemeName = 'light' | 'dark' | 'sepia' | 'dracula' | 'one-dark';
export type FontStyle = 'default' | 'serif' | 'mono' | 'compact';

interface ThemeOption { value: ThemeName; label: string; }
interface FontOption { value: FontStyle; label: string; }

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'sepia', label: '护眼' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'one-dark', label: 'One Dark' },
];

const FONT_OPTIONS: FontOption[] = [
  { value: 'default', label: '默认' },
  { value: 'serif', label: '衬线' },
  { value: 'mono', label: '等宽' },
  { value: 'compact', label: '紧凑' },
];

const FONT_CONFIG: Record<FontStyle, { fontFamily: string; lineHeight: string }> = {
  default: { fontFamily: '', lineHeight: '1.6' },
  serif: { fontFamily: "Georgia, 'Noto Serif SC', 'Source Han Serif', serif", lineHeight: '1.8' },
  mono: { fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace", lineHeight: '1.5' },
  compact: { fontFamily: '', lineHeight: '1.4' },
};

const THEME_KEY = 'mdread-theme';
const FONT_KEY = 'mdread-font-style';

export function initTheme(): void {
  const savedTheme = localStorage.getItem(THEME_KEY) as ThemeName | null;
  const theme = savedTheme && THEME_OPTIONS.some(t => t.value === savedTheme) ? savedTheme : 'light';
  applyTheme(theme);
  const savedFont = localStorage.getItem(FONT_KEY) as FontStyle | null;
  const font = savedFont && FONT_OPTIONS.some(f => f.value === savedFont) ? savedFont : 'default';
  applyFont(font);
}

export function setTheme(theme: ThemeName): void { applyTheme(theme); }
export function getCurrentTheme(): ThemeName {
  return (document.documentElement.getAttribute('data-theme') as ThemeName) || 'light';
}
export function getThemeOptions(): ThemeOption[] { return THEME_OPTIONS; }

export function setFont(font: FontStyle): void { applyFont(font); }
export function getCurrentFont(): FontStyle {
  return (localStorage.getItem(FONT_KEY) as FontStyle) || 'default';
}
export function getFontOptions(): FontOption[] { return FONT_OPTIONS; }

function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

function applyFont(font: FontStyle): void {
  const config = FONT_CONFIG[font];
  const root = document.documentElement;
  if (config.fontFamily) {
    root.style.setProperty('--font-family', config.fontFamily);
  } else {
    // 默认字体: 移除覆盖, 使用主题定义的字体
    root.style.removeProperty('--font-family');
  }
  root.style.setProperty('--line-height', config.lineHeight);
  localStorage.setItem(FONT_KEY, font);
}
