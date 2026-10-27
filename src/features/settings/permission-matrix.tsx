'use client';

import * as React from 'react';
import { Check, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ROLE_LABELS, ROLE_PERMISSIONS, type Permission } from '@/lib/permissions';

/**
 * The permission matrix, rendered from the same constant the server enforces.
 *
 * This is generated rather than hand-written documentation, so it cannot
 * drift away from the behaviour it describes — if a permission moves between
 * roles, this table moves with it.
 */

const GROUPS: { title: string; permissions: { key: Permission; label: string }[] }[] = [
  {
    title: 'Clients',
    permissions: [
      { key: 'client:read', label: 'View clients' },
      { key: 'client:read_sensitive', label: 'View contact details and notes' },
      { key: 'client:create', label: 'Create clients' },
      { key: 'client:update', label: 'Edit clients' },
      { key: 'client:archive', label: 'Archive clients' },
      { key: 'client:delete', label: 'Delete clients' },
      { key: 'client:import', label: 'Import from a spreadsheet' },
      { key: 'client:export', label: 'Export to CSV' },
    ],
  },
  {
    title: 'Projects and tasks',
    permissions: [
      { key: 'project:read', label: 'View projects' },
      { key: 'project:read_all', label: 'View every project, not just assigned' },
      { key: 'project:create', label: 'Create projects' },
      { key: 'project:update', label: 'Edit projects' },
      { key: 'project:manage_members', label: 'Manage project membership' },
      { key: 'task:update', label: 'Edit tasks' },
      { key: 'task:delete', label: 'Delete tasks' },
    ],
  },
  {
    title: 'Invoices and payments',
    permissions: [
      { key: 'invoice:read', label: 'View invoices' },
      { key: 'invoice:create', label: 'Create drafts' },
      { key: 'invoice:issue', label: 'Issue invoices' },
      { key: 'invoice:send', label: 'Send invoices' },
      { key: 'invoice:void', label: 'Void issued invoices' },
      { key: 'invoice:delete', label: 'Delete drafts' },
      { key: 'payment:create', label: 'Record payments' },
      { key: 'payment:delete', label: 'Remove payments' },
      { key: 'creditnote:create', label: 'Issue credit notes' },
    ],
  },
  {
    title: 'Cards and subscriptions',
    permissions: [
      { key: 'card:read', label: 'View the card inventory' },
      { key: 'card:create', label: 'Add cards' },
      { key: 'card:delete', label: 'Delete cards' },
      { key: 'platformlink:manage', label: 'Record where cards are saved' },
      { key: 'subscription:create', label: 'Create subscriptions' },
      { key: 'expense:create', label: 'Record expenses' },
    ],
  },
  {
    title: 'Files',
    permissions: [
      { key: 'file:read', label: 'View files' },
      { key: 'file:upload', label: 'Upload files' },
      { key: 'file:download', label: 'Download files' },
      { key: 'file:delete', label: 'Delete files' },
      { key: 'file:import_data', label: 'Import spreadsheet data' },
    ],
  },
  {
    title: 'Reporting and administration',
    permissions: [
      { key: 'report:read', label: 'View reports' },
      { key: 'report:read_office_finance', label: 'View office-wide finances' },
      { key: 'report:export', label: 'Export reports' },
      { key: 'exchangerate:manage', label: 'Manage exchange rates' },
      { key: 'audit:read', label: 'Read the activity log' },
      { key: 'team:invite', label: 'Add team members' },
      { key: 'team:update_role', label: 'Change roles' },
      { key: 'settings:update', label: 'Change settings' },
      { key: 'workspace:transfer_ownership', label: 'Transfer ownership' },
    ],
  },
];

const ROLES = ['OWNER', 'ADMIN', 'FINANCE', 'MANAGER', 'STAFF'] as const;

const ROLE_SETS = Object.fromEntries(
  ROLES.map((role) => [role, new Set<string>(ROLE_PERMISSIONS[role])]),
) as Record<(typeof ROLES)[number], Set<string>>;

export function PermissionMatrix() {
  const [open, setOpen] = React.useState(false);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Full permission matrix</CardTitle>
          <p className="text-ink-subtle mt-0.5 text-xs">
            Generated from the same table the server checks on every request.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-brand-500 focus-visible:ring-brand-500/40 shrink-0 rounded text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </CardHeader>

      {open ? (
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Permissions granted to each role</caption>
            <thead>
              <tr className="border-line border-b">
                <th
                  scope="col"
                  className="text-ink-subtle py-2 pr-4 text-left text-[11px] font-semibold tracking-wide uppercase"
                >
                  Capability
                </th>
                {ROLES.map((role) => (
                  <th
                    key={role}
                    scope="col"
                    className="text-ink-subtle px-2 py-2 text-center text-[11px] font-semibold tracking-wide uppercase"
                  >
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((group) => (
                <React.Fragment key={group.title}>
                  <tr className="border-line bg-surface-sunken/60 border-b">
                    <th
                      scope="colgroup"
                      colSpan={ROLES.length + 1}
                      className="text-ink py-1.5 pr-4 text-left text-[11px] font-semibold"
                    >
                      {group.title}
                    </th>
                  </tr>
                  {group.permissions.map((permission) => (
                    <tr key={permission.key} className="border-line border-b last:border-0">
                      <td className="text-ink-muted py-1.5 pr-4 text-[13px]">{permission.label}</td>
                      {ROLES.map((role) => {
                        const allowed = ROLE_SETS[role].has(permission.key);
                        return (
                          <td key={role} className="px-2 py-1.5 text-center">
                            <span className="sr-only">
                              {ROLE_LABELS[role]}: {allowed ? 'allowed' : 'not allowed'}
                            </span>
                            {allowed ? (
                              <Check className="text-success mx-auto size-3.5" aria-hidden />
                            ) : (
                              <Minus className="text-ink-subtle/40 mx-auto size-3.5" aria-hidden />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </CardContent>
      ) : null}
    </Card>
  );
}
