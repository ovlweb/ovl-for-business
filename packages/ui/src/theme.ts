import { cssVarName, getTheme, resolveThemeId, type Theme, type ThemeColors } from '@ovl/shared';

const PREFERENCE_KEY = 'ovl.theme';
/** Resolved CSS variables of the last theme, applied by an inline script before first paint. */
export const THEME_CACHE_KEY = 'ovl.theme.vars';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getThemePreference(): string {
  return storage()?.getItem(PREFERENCE_KEY) ?? 'system';
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function themeVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [token, value] of Object.entries(theme.colors) as [keyof ThemeColors, string][]) {
    vars[cssVarName(token)] = value;
  }
  return vars;
}

function paint(theme: Theme): void {
  const root = document.documentElement;
  const vars = themeVariables(theme);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.dataset.theme = theme.id;
  root.dataset.mode = theme.mode;
  root.style.colorScheme = theme.mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.sidebarBg);
  storage()?.setItem(THEME_CACHE_KEY, JSON.stringify({ vars, id: theme.id, mode: theme.mode }));
}

export interface ApplyThemeOptions {
  /** Screen point where the theme change starts (circular reveal). */
  origin?: { x: number; y: number };
  /** Remember the preference on this device (default true). */
  persist?: boolean;
}

/** Apply a theme preference ("system" or a theme id), optionally with an animated circular reveal. */
export function applyTheme(preference: string, options: ApplyThemeOptions = {}): Theme {
  const theme = getTheme(resolveThemeId(preference, prefersDark()));
  if (options.persist !== false) storage()?.setItem(PREFERENCE_KEY, preference);
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  const origin = options.origin;
  if (
    !origin ||
    !doc.startViewTransition ||
    prefersReducedMotion() ||
    document.documentElement.dataset.theme === theme.id
  ) {
    paint(theme);
    return theme;
  }
  const radius = Math.hypot(
    Math.max(origin.x, innerWidth - origin.x),
    Math.max(origin.y, innerHeight - origin.y),
  );
  const transition = doc.startViewTransition(() => paint(theme));
  void transition.ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${origin.x}px ${origin.y}px)`,
          `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
        ],
      },
      {
        duration: 650,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        pseudoElement: '::view-transition-new(root)',
      },
    );
  });
  return theme;
}

/** Keep "system" in sync with the OS setting. Returns an unsubscribe function. */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!media) return () => undefined;
  const onChange = () => {
    if (getThemePreference() === 'system') applyTheme('system');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
