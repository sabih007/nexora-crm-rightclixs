'use client';

import * as React from 'react';

/**
 * Shared client hooks.
 *
 * These exist mainly so components avoid the `setState` inside `useEffect`
 * pattern, which triggers cascading renders and is flagged by the React
 * compiler lint rules.
 */

const emptySubscribe = () => () => {};

/**
 * True only after hydration. Uses `useSyncExternalStore` so the server and
 * the first client render agree (`false`), then flips once — without a
 * state update inside an effect.
 */
export function useIsMounted(): boolean {
  return React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Debounce a callback. The timer lives in a ref and is cleared on unmount,
 * so a value typed and then navigated away from never fires a stale update.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number,
): (...args: Args) => void {
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbackRef = React.useRef(callback);

  React.useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return React.useCallback(
    (...args: Args) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => callbackRef.current(...args), delay);
    },
    [delay],
  );
}

/** Read and write a cookie from the client, for small UI preferences. */
export function setPreferenceCookie(name: string, value: string, days = 365): void {
  try {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch {
    /* document unavailable — preference simply is not persisted */
  }
}
