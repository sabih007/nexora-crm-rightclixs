'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, CreditCard, Globe, LayoutGrid, Receipt } from 'lucide-react';
import type { Role } from '@/generated/prisma/enums';
import { type Permission, roleHasPermission } from '@/lib/permissions';
import { cn } from '@/lib/utils';

const TABS: { href: string; label: string; icon: typeof LayoutGrid; permission: Permission }[] = [
  { href: '/subscriptions', label: 'Overview', icon: LayoutGrid, permission: 'subscription:read' },
  { href: '/subscriptions/cards', label: 'Cards', icon: CreditCard, permission: 'card:read' },
  { href: '/subscriptions/platforms', label: 'Platforms', icon: Globe, permission: 'platform:read' },
  { href: '/subscriptions/calendar', label: 'Calendar', icon: CalendarDays, permission: 'subscription:read' },
  { href: '/subscriptions/expenses', label: 'Expenses', icon: Receipt, permission: 'expense:read' },
];

export function SubscriptionTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  const visible = TABS.filter((tab) => roleHasPermission(role, tab.permission));

  return (
    <nav aria-label="Subscriptions sections" className="border-b border-line">
      <ul className="flex gap-1 overflow-x-auto">
        {visible.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded-t',
                  active
                    ? 'border-brand-500 text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
