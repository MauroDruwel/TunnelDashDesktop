import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

// Shared storage key used by App.tsx and any component that needs theme
export const THEME_KEY = "cf-theme";

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark-theme", theme === "dark");
  // Keep light-theme toggle for compatibility but primary check is dark-theme
  root.classList.toggle("light-theme", theme === "light");
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const urlTheme = new URLSearchParams(window.location.search).get("theme");
    if (urlTheme === "light" || urlTheme === "dark") return urlTheme;
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return stored === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  return {
    theme,
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
  };
}
