'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Bell,
  Check,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
  User as UserIcon,
  X,
} from 'lucide-react';
import type { Role } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS } from '@/lib/permissions';
import { useIsMounted, setPreferenceCookie } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';
import { CommandPalette } from './command-palette';
import { NotificationBell } from './notification-bell';

export interface ShellUser {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
}

/**
 * Application frame: fixed sidebar on desktop, slide-over drawer on mobile,
 * compact top bar with command search, notifications, theme and profile.
 */
export function AppShell({
  user,
  role,
  workspaceName,
  baseCurrency,
  unreadCount,
  defaultCollapsed = false,
  children,
}: {
  user: ShellUser;
  role: Role;
  workspaceName: string;
  baseCurrency: string;
  unreadCount: number;
  /** Read server-side from a cookie so the sidebar never flashes open. */
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      setPreferenceCookie('nexora-sidebar', next ? 'collapsed' : 'expanded');
      return next;
    });
  }

  // Cmd/Ctrl+K opens the command palette from anywhere.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-brand-500 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen shrink-0 lg:block">
        <Sidebar role={role} workspaceName={workspaceName} collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-[#0b1220]/50 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-60 shadow-lg animate-in-fade">
            <Sidebar role={role} workspaceName={workspaceName} onNavigate={() => setDrawerOpen(false)} />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              className="absolute right-2 top-3 rounded-md p-1.5 text-ink-subtle hover:bg-surface-hover hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-md no-print sm:px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden lg:inline-flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className={cn(
              'group flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface-sunken px-2.5',
              'text-[13px] text-ink-subtle transition-colors hover:border-line-strong hover:text-ink-muted',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:max-w-xs',
            )}
          >
            <Search className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">Search clients, invoices…</span>
            <kbd className="ml-auto hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-subtle sm:inline">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-1">
            <Badge tone="outline" className="hidden sm:inline-flex" title="Workspace base currency">
              {baseCurrency}
            </Badge>

            <NotificationBell initialUnread={unreadCount} />
            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="ml-0.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                  aria-label="Account menu"
                >
                  <Avatar name={user.name} color={user.avatarColor} size="md" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <span className="block truncate text-[13px] font-semibold normal-case tracking-normal text-ink">
                    {user.name}
                  </span>
                  <span className="block truncate text-[11px] font-normal normal-case tracking-normal text-ink-subtle">
                    {user.email}
                  </span>
                  <Badge tone="brand" size="sm" className="mt-1.5">
                    {ROLE_LABELS[role]}
                  </Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings/profile">
                    <UserIcon /> Profile & security
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings /> Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={handleSignOut}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main id="main-content" className="min-w-0 flex-1 px-3 py-5 sm:px-5 lg:px-7 lg:py-7">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} role={role} />
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // `theme` is only meaningful after hydration; before that we render the
  // neutral system icon so server and client markup agree.
  const mounted = useIsMounted();

  const options = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Change theme">
          {!mounted ? (
            <Monitor />
          ) : theme === 'dark' ? (
            <Moon />
          ) : theme === 'light' ? (
            <Sun />
          ) : (
            <Monitor />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((opt) => {
          const Icon = opt.icon;
          return (
            <DropdownMenuItem key={opt.value} onSelect={() => setTheme(opt.value)}>
              <Icon />
              <span className="flex-1">{opt.label}</span>
              {mounted && theme === opt.value ? <Check className="size-3.5 text-brand-500" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { Bell };
