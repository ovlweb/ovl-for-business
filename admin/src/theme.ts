import { applyTheme, getThemePreference } from '@ovl/ui';
import { useState } from 'react';

/** The staff console starts in the dark amber theme so it never looks like the client app. */
export const DEFAULT_ADMIN_THEME = 'graphite';

export function useAdminTheme(): [string, (id: string, origin?: { x: number; y: number }) => void] {
  const [theme, setTheme] = useState(() => getThemePreference(DEFAULT_ADMIN_THEME));
  return [
    theme,
    (id, origin) => {
      setTheme(id);
      applyTheme(id, { origin });
    },
  ];
}
