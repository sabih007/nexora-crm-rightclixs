'use client';

import { ThemeProvider as NextThemeProvider } from 'next-themes';

/**
 * Light / dark / system theme.
 * The class strategy pairs with the `.dark` custom variant in globals.css,
 * and `next-themes` writes the choice to localStorage and applies it before
 * first paint so there is no flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="nexora-theme"
    >
      {children}
    </NextThemeProvider>
  );
}
