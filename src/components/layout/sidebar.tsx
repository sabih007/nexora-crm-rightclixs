'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  CreditCard,
  FileSpreadsheet,
  FolderKanban,
  LayoutDashboard,
  type LucideIcon,
  PieChart,
  Receipt,
  Settings,
  Users,
  UsersRound,
} from 'lucide-react';
import type { Role } from '@/generated/prisma/enums';
import { type Permission, roleHasAnyPermission } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/**
 * Primary navigation.
 *
 * Each entry declares the permissions that make it meaningful. An item the
 * current role cannot use is not rendered at all — and because the matching
 * route runs the same check server-side, hiding it is a UX nicety rather than
 * the security boundary.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permissions: Permission[];
  /** Match nested routes (default true). */
  exact?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, permissions: ['workspace:read'], exact: true },
  { href: '/clients', label: 'Clients', icon: Users, permissions: ['client:read'] },
  { href: '/invoices', label: 'Invoices', icon: Receipt, permissions: ['invoice:read'] },
  { href: '/files', label: 'Sheets & Files', icon: FileSpreadsheet, permissions: ['file:read'] },
  { href: '/subscriptions', label: 'Subscriptions', icon: CreditCard, permissions: ['subscription:read', 'card:read', 'platform:read'] },
  { href: '/projects', label: 'Projects', icon: FolderKanban, permissions: ['project:read'] },
  { href: '/reports', label: 'Reports', icon: PieChart, permissions: ['report:read'] },
  { href: '/activity', label: 'Activity Log', icon: Activity, permissions: ['audit:read'] },
  { href: '/team', label: 'Team & Roles', icon: UsersRound, permissions: ['team:invite', 'team:update_role'] },
  { href: '/settings', label: 'Settings', icon: Settings, permissions: ['settings:read'] },
];

export function visibleNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => roleHasAnyPermission(role, item.permissions));
}

export function Sidebar({
  role,
  workspaceName,
  collapsed,
  onNavigate,
}: {
  role: Role;
  workspaceName: string;
  collapsed?: boolean;
  /** Called after a link is activated — used to close the mobile drawer. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = React.useMemo(() => visibleNavItems(role), [role]);

  return (
    <nav
      aria-label="Main navigation"
      className={cn(
        'flex h-full flex-col border-r border-line bg-surface',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4')}>
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink text-sm font-bold text-accent"
          aria-hidden
        >
          N
        </span>
        {!collapsed ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-tight text-ink">
              Nexora OS
            </span>
            <span className="block truncate text-[11px] leading-tight text-ink-subtle">
              {workspaceName}
            </span>
          </span>
        ) : null}
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                  active
                    ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300'
                    : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
                  collapsed && 'justify-center px-0',
                )}
              >
                <Icon
                  className={cn('size-4 shrink-0', active ? 'text-brand-500' : 'text-ink-subtle group-hover:text-ink')}
                  aria-hidden
                />
                {!collapsed ? <span className="truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>

      {!collapsed ? (
        <div className="border-t border-line px-3 py-2.5">
          <p className="text-[10px] leading-relaxed text-ink-subtle">
            Management reporting only. Not certified financial statements.
          </p>
        </div>
      ) : null}
    </nav>
  );
}
