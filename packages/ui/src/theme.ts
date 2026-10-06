import { useCallback, useEffect, useState } from 'react';

export const THEMES = ['system', 'light', 'dark', 'high-contrast'] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = 'verbis.theme';

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Reads the stored preference; storage can be unavailable (private mode, embedded iframes). */
export function readStoredTheme(storage: Pick<Storage, 'getItem'> | undefined): Theme {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return isTheme(value) ? value : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme, root: HTMLElement): void {
  if (theme === 'system') {
    delete root.dataset['theme'];
  } else {
    root.dataset['theme'] = theme;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Theme state synchronized with <html data-theme> and persisted per viewer. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme(safeStorage()));

  useEffect(() => {
    applyTheme(theme, document.documentElement);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      safeStorage()?.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is a convenience only.
    }
  }, []);

  return [theme, setTheme];
}
