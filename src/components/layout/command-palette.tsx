'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  ArrowRight,
  Building2,
  CreditCard,
  FolderKanban,
  Loader2,
  Receipt,
  Search,
} from 'lucide-react';
import type { Role } from '@/generated/prisma/enums';
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { visibleNavItems } from './sidebar';
import { cn } from '@/lib/utils';

/**
 * Global command search (⌘K).
 *
 * Navigation entries come from the same permission-filtered list the sidebar
 * uses. Entity results are fetched from `/api/search`, which applies the same
 * server-side scope rules as the list pages — the palette can never surface a
 * record the user is not allowed to open.
 */

interface SearchHit {
  type: 'client' | 'invoice' | 'project' | 'subscription';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const TYPE_ICONS = {
  client: Building2,
  invoice: Receipt,
  project: FolderKanban,
  subscription: CreditCard,
} as const;

const TYPE_LABELS = {
  client: 'Clients',
  invoice: 'Invoices',
  project: 'Projects',
  subscription: 'Subscriptions',
} as const;

export function CommandPalette({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);

  const navItems = React.useMemo(() => visibleNavItems(role), [role]);

  const term = query.trim();
  const searching = term.length >= 2;

  React.useEffect(() => {
    if (!searching) return;

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('search failed');
        const data: { results: SearchHit[] } = await res.json();
        setHits(data.results);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setHits([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term, searching]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Reset here rather than in an effect, so closing is a single render.
      setQuery('');
      setHits([]);
      setLoading(false);
    }
    onOpenChange(next);
  }

  function go(href: string) {
    handleOpenChange(false);
    router.push(href);
  }

  const grouped = React.useMemo(() => {
    const map = new Map<SearchHit['type'], SearchHit[]>();
    for (const hit of searching ? hits : []) {
      const list = map.get(hit.type) ?? [];
      list.push(hit);
      map.set(hit.type, list);
    }
    return [...map.entries()];
  }, [hits, searching]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            'fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2',
            'border-line bg-surface-raised animate-in-fade overflow-hidden rounded-xl border shadow-lg focus:outline-none',
          )}
          aria-label="Command palette"
        >
          <DialogPrimitive.Title className="sr-only">Search Nexora OS</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search clients, invoices, projects and subscriptions, or jump to a section.
          </DialogPrimitive.Description>

          <Command shouldFilter={false} loop className="flex flex-col">
            <div className="border-line flex items-center gap-2.5 border-b px-3.5">
              <Search className="text-ink-subtle size-4 shrink-0" aria-hidden />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                autoFocus
                placeholder="Search clients, invoices, projects…"
                className="text-ink placeholder:text-ink-subtle h-12 flex-1 bg-transparent text-sm outline-none"
              />
              {loading ? (
                <Loader2 className="text-ink-subtle size-4 animate-spin" aria-hidden />
              ) : null}
            </div>

            <Command.List className="max-h-[22rem] overflow-y-auto p-1.5">
              <Command.Empty className="text-ink-subtle px-3 py-8 text-center text-sm">
                {!searching
                  ? 'Type at least two characters to search.'
                  : loading
                    ? 'Searching…'
                    : 'No matches found.'}
              </Command.Empty>

              {grouped.map(([type, items]) => {
                const Icon = TYPE_ICONS[type];
                return (
                  <Command.Group
                    key={type}
                    heading={TYPE_LABELS[type]}
                    className="[&_[cmdk-group-heading]]:text-ink-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:uppercase"
                  >
                    {items.map((hit) => (
                      <Command.Item
                        key={`${hit.type}-${hit.id}`}
                        value={`${hit.type}-${hit.id}`}
                        onSelect={() => go(hit.href)}
                        className="text-ink data-[selected=true]:bg-surface-hover flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm"
                      >
                        <Icon className="text-ink-subtle size-4 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                        {hit.subtitle ? (
                          <span className="text-ink-subtle shrink-0 text-xs">{hit.subtitle}</span>
                        ) : null}
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}

              {!searching ? (
                <Command.Group
                  heading="Go to"
                  className="[&_[cmdk-group-heading]]:text-ink-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:uppercase"
                >
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Command.Item
                        key={item.href}
                        value={item.href}
                        onSelect={() => go(item.href)}
                        className="text-ink data-[selected=true]:bg-surface-hover flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm"
                      >
                        <Icon className="text-ink-subtle size-4 shrink-0" aria-hidden />
                        <span className="flex-1">{item.label}</span>
                        <ArrowRight className="text-ink-subtle size-3.5" aria-hidden />
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
