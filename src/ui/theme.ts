import { LIMITS } from '../core/config';
import { state } from './state';
import { $ } from './dom';

const THEME_COLORS: Record<'dark' | 'light' | 'space', string> = {
  dark: '#17191d',
  light: '#f3f4f1',
  space: '#060a14',
};

export function setupTheme(): void {
  let saved = 'dark';
  try {
    saved = localStorage.getItem(LIMITS.preferences.storageKey) ?? 'dark';
  } catch {
    /* Storage is optional */
  }

  state.theme = saved === 'light' || saved === 'space' ? saved : 'dark';
  const select = $('themeSelect') as HTMLSelectElement;
  select.value = state.theme;

  const applyTheme = () => {
    document.documentElement.dataset['theme'] = state.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[state.theme]);
  };

  select.addEventListener('change', () => {
    state.theme = select.value === 'light' || select.value === 'space' ? select.value : 'dark';
    try {
      localStorage.setItem(LIMITS.preferences.storageKey, state.theme);
    } catch {}
    applyTheme();
  });
  applyTheme();
}
