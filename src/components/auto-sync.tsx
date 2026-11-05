'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const FIVE_MIN = 5 * 60 * 1000;

export function AutoSync() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let running = false;

    async function run() {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const res = await fetch('/api/domains/sync', { method: 'POST' });
        const data = await res.json();
        // refresh the screen only if new data came in and user is viewing it
        if (res.ok && !data.skipped &&
            (pathname.startsWith('/domains') || pathname.startsWith('/subscriptions'))) {
          router.refresh();
        }
      } catch {
        // silent — next run will retry
      } finally {
        running = false;
      }
    }

    run();                                   // sync on login / page open
    const id = setInterval(run, FIVE_MIN);   // then every 5 minutes

    // when user comes back to the tab, catch up
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pathname, router]);

  return null; // invisible
}