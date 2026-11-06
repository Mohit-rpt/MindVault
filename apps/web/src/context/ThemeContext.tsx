import React, { createContext, useContext, useEffect, useState } from 'react';

export type AppTheme = 'cream' | 'graphite';

interface ThemeContextType {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'mindvault_theme';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<AppTheme>(() => {
    // 1. Check saved local preference
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as AppTheme | null;
    if (saved === 'cream' || saved === 'graphite') {
      return saved;
    }

    // 2. Fall back to system preference (Graphite if system dark, else Warm Cream)
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'graphite';
      }
    }

    // Default: Warm Cream
    return 'cream';
  });

  const applyThemeToDOM = (activeTheme: AppTheme) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', activeTheme);

    if (activeTheme === 'graphite') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Modern Web Guidance: update meta color-scheme
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) {
      meta.setAttribute('content', activeTheme === 'graphite' ? 'dark' : 'light');
    }
  };

  useEffect(() => {
    applyThemeToDOM(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // Handle system preference changes if user hasn't explicitly overridden
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      const hasSaved = localStorage.getItem(THEME_STORAGE_KEY);
      if (!hasSaved) {
        setThemeState(e.matches ? 'graphite' : 'cream');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const setTheme = (newTheme: AppTheme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'cream' ? 'graphite' : 'cream'));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
