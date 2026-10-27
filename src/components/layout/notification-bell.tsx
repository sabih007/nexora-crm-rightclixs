'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/misc';
import { formatDateTime } from '@/lib/dates';
import { csrfHeaders } from '@/lib/hooks';
import { cn } from '@/lib/utils';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Notification popover.
 *
 * Loads on open rather than polling: an office CRM does not need a websocket
 * for renewal reminders, and a fetch-on-open keeps the page cheap.
 */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [unread, setUnread] = React.useState(initialUnread);
  const [loading, setLoading] = React.useState(false);

  // Loaded when the popover opens rather than polled. State updates happen
  // inside the async callback, never synchronously in the effect body.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/notifications');
        const data: { notifications: NotificationItem[] } = res.ok
          ? await res.json()
          : { notifications: [] };
        if (!cancelled) setItems(data.notifications);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function markAllRead() {
    await fetch('/api/notifications', { method: 'POST', headers: csrfHeaders() });
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    router.refresh();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative"
        >
          <Bell />
          {unread > 0 ? (
            <span className="bg-danger absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] leading-4 font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-line flex items-center justify-between border-b px-3.5 py-2.5">
          <p className="text-ink text-sm font-semibold">Notifications</p>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
              className="text-brand-500 inline-flex items-center gap-1 rounded text-xs font-medium hover:underline"
            >
              <CheckCheck className="size-3.5" aria-hidden /> Mark all read
            </button>
          ) : null}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <p className="text-ink-subtle px-3.5 py-6 text-center text-sm">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-ink-subtle px-3.5 py-8 text-center text-sm">
              Nothing to catch up on.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {items.map((n) => {
                const content = (
                  <div
                    className={cn(
                      'hover:bg-surface-hover px-3.5 py-2.5 transition-colors',
                      !n.readAt && 'bg-brand-500/[0.04]',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!n.readAt ? (
                        <span
                          className="bg-brand-500 mt-1.5 size-1.5 shrink-0 rounded-full"
                          aria-label="Unread"
                        />
                      ) : (
                        <span className="mt-1.5 size-1.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-ink text-[13px] font-medium">{n.title}</p>
                        <p className="text-ink-muted mt-0.5 text-xs">{n.body}</p>
                        <p className="text-ink-subtle mt-1 text-[10px]">
                          {formatDateTime(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                );

                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link href={n.link} onClick={() => setOpen(false)} className="block">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
