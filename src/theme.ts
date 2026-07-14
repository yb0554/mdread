/** Theme and typography preferences, including a live system-following mode. */

import { getString, setString, StorageKeys } from './storage';

export type ThemeName = 'light' | 'dark' | 'sepia' | 'dracula' | 'one-dark';
export type ThemePreference = ThemeName | 'system';
export type FontStyle = 'default' | 'serif' | 'mono' | 'compact';

interface ThemeOption { value: ThemePreference; label: string; }
interface FontOption { value: FontStyle; label: string; }

const THEMES: ThemeOption[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'sepia', label: '护眼' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'one-dark', label: 'One Dark' },
];
const FONTS: FontOption[] = [
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
const media = window.matchMedia?.('(prefers-color-scheme: dark)');

function systemTheme(): ThemeName {
  return media?.matches ? 'dark' : 'light';
}

export function initTheme(): void {
  const saved = getString(StorageKeys.THEME, 'system') as ThemePreference;
  applyTheme(THEMES.some((theme) => theme.value === saved) ? saved : 'system');
  const font = getString(StorageKeys.FONT_STYLE, 'default') as FontStyle;
  applyFont(FONTS.some((option) => option.value === font) ? font : 'default');
  media?.addEventListener('change', () => {
    if (getCurrentThemePreference() === 'system') applyTheme('system', false);
  });
}

export function setTheme(theme: ThemePreference): void { applyTheme(theme); }
export function getCurrentTheme(): ThemeName { return (document.documentElement.dataset.theme as ThemeName) || 'light'; }
export function getCurrentThemePreference(): ThemePreference {
  const value = getString(StorageKeys.THEME, 'system') as ThemePreference;
  return THEMES.some((theme) => theme.value === value) ? value : 'system';
}
export function getThemeOptions(): ThemeOption[] { return THEMES; }
export function setFont(font: FontStyle): void { applyFont(font); }
export function getCurrentFont(): FontStyle { return getString(StorageKeys.FONT_STYLE, 'default') as FontStyle; }
export function getFontOptions(): FontOption[] { return FONTS; }

function applyTheme(preference: ThemePreference, persist = true): void {
  document.documentElement.dataset.theme = preference === 'system' ? systemTheme() : preference;
  if (persist) setString(StorageKeys.THEME, preference);
}

function applyFont(font: FontStyle): void {
  const config = FONT_CONFIG[font];
  const root = document.documentElement;
  if (config.fontFamily) root.style.setProperty('--font-family', config.fontFamily);
  else root.style.removeProperty('--font-family');
  root.style.setProperty('--line-height', config.lineHeight);
  setString(StorageKeys.FONT_STYLE, font);
}
