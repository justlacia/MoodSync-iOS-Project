import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getSetting, setSetting } from '../database/iosDatabase';
import { THEME_LIST, ThemeId, ThemePalette, Themes } from './colors';

interface ThemeContextValue {
  themeId: ThemeId;
  colors: ThemePalette;
  isDark: boolean;
  themes: ThemePalette[];
  setThemeId: (id: ThemeId) => Promise<void>;
  cycleTheme: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: 'oled',
  colors: Themes.oled,
  isDark: true,
  themes: THEME_LIST,
  setThemeId: async () => {},
  cycleTheme: async () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeId, setThemeIdState] = useState<ThemeId>('oled');

  useEffect(() => {
    getSetting('app_theme')
      .then((saved) => {
        if (saved && saved in Themes) {
          setThemeIdState(saved as ThemeId);
        }
      })
      .catch(() => {});
  }, []);

  const setThemeId = useCallback(async (id: ThemeId) => {
    setThemeIdState(id);
    await setSetting('app_theme', id).catch(() => {});
  }, []);

  const cycleTheme = useCallback(async () => {
    const order: ThemeId[] = ['oled', 'obsidian', 'midnight', 'light'];
    const next = order[(order.indexOf(themeId) + 1) % order.length];
    await setThemeId(next);
  }, [setThemeId, themeId]);

  const colors = Themes[themeId] || Themes.oled;

  return (
    <ThemeContext.Provider
      value={{
        themeId,
        colors,
        isDark: colors.isDark,
        themes: THEME_LIST,
        setThemeId,
        cycleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
