'use client';

import { Toaster } from 'sonner';
import { useTheme } from 'next-themes';

export function ToastProvider() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{
        style: {
          borderRadius: '0.625rem',
          fontSize: '13px',
        },
      }}
    />
  );
}
