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

/**
 * A per-viewer UI preference backed by localStorage.
 *
 * Implemented with `useSyncExternalStore` rather than `useState` + `useEffect`
 * so the server render and the first client render agree on `fallback`, and
 * the stored value is adopted without a state update inside an effect.
 * Storage failures (private mode, blocked site data) degrade to the fallback.
 */
export function useStoredPreference<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const handler = (event: Event) => {
        if (event instanceof StorageEvent && event.key !== null && event.key !== key) return;
        onChange();
      };
      window.addEventListener('storage', handler);
      window.addEventListener('nexora:preference', handler);
      return () => {
        window.removeEventListener('storage', handler);
        window.removeEventListener('nexora:preference', handler);
      };
    },
    [key],
  );

  const getSnapshot = React.useCallback(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return allowed.includes(stored as T) ? (stored as T) : fallback;
    } catch {
      return fallback;
    }
  }, [key, allowed, fallback]);

  const value = React.useSyncExternalStore(subscribe, getSnapshot, () => fallback);

  const setValue = React.useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* preference simply is not persisted */
      }
      window.dispatchEvent(new Event('nexora:preference'));
    },
    [key],
  );

  return [value, setValue];
}

/**
 * Read the script-readable CSRF cookie the session issued.
 *
 * State-changing route handlers verify both the Origin and this token, so
 * any `fetch` that mutates must send it. Server Actions do not need it —
 * Next verifies their origin itself.
 */
export function csrfHeaders(): Record<string, string> {
  try {
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith('nexora_csrf=') || row.startsWith('__Host-nexora_csrf='));
    const value = match?.split('=')[1];
    return value ? { 'x-csrf-token': decodeURIComponent(value) } : {};
  } catch {
    return {};
  }
}
