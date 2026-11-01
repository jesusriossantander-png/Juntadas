export type ThemePref = 'system' | 'dark' | 'light';
const KEY = 'la-juntada:theme';

export function getThemePref(): ThemePref {
  return (localStorage.getItem(KEY) as ThemePref) || 'system';
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#15110e' : '#f7f2ec');
}

export function setThemePref(pref: ThemePref) {
  localStorage.setItem(KEY, pref);
  applyTheme(pref);
}

if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
}
