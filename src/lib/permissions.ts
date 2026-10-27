import { Role } from '@/generated/prisma/enums';

/**
 * Central permission matrix.
 *
 * Every server action, route handler, export and download resolves its
 * authorization through `can()` / `requirePermission()` in `src/lib/auth/guard.ts`.
 * The matrix is deny-by-default: a permission absent from a role's list is
 * denied, and an unknown permission string is denied.
 *
 * Object-level checks (does this user actually belong to this project?) are
 * layered on top of these coarse capability checks — see `scope.ts`.
 */

export const PERMISSIONS = [
  // Workspace & team
  'workspace:read',
  'workspace:update',
  'workspace:transfer_ownership',
  'team:read',
  'team:invite',
  'team:update_role',
  'team:remove',

  // Clients
  'client:read',
  'client:read_sensitive', // email / phone / tax id / notes
  'client:create',
  'client:update',
  'client:archive',
  'client:delete',
  'client:import',
  'client:export',

  // Projects & tasks
  'project:read',
  'project:read_all', // beyond own assignments
  'project:create',
  'project:update',
  'project:delete',
  'project:manage_members',
  'task:read',
  'task:create',
  'task:update',
  'task:delete',
  'task:comment',

  // Invoices & payments
  'invoice:read',
  'invoice:create',
  'invoice:update',
  'invoice:issue',
  'invoice:send',
  'invoice:void',
  'invoice:delete',
  'invoice:download_pdf',
  'payment:read',
  'payment:create',
  'payment:update',
  'payment:delete',
  'creditnote:create',

  // Files
  'file:read',
  'file:upload',
  'file:update',
  'file:delete',
  'file:download',
  'file:import_data',

  // Cards, platforms, subscriptions
  'card:read',
  'card:create',
  'card:update',
  'card:delete',
  'platform:read',
  'platform:create',
  'platform:update',
  'platform:delete',
  'platformlink:manage',
  'subscription:read',
  'subscription:create',
  'subscription:update',
  'subscription:delete',
  'expense:read',
  'expense:create',
  'expense:update',
  'expense:delete',

  // Reporting & finance
  'report:read',
  'report:read_office_finance',
  'report:export',
  'exchangerate:read',
  'exchangerate:manage',

  // System
  'audit:read',
  'settings:read',
  'settings:update',
  'notification:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

/**
 * Admin: everything except ownership transfer and workspace deletion-level
 * configuration reserved for the Owner.
 */
const ADMIN: Permission[] = ALL.filter((p) => p !== 'workspace:transfer_ownership');

/**
 * Finance: owns the money. Full invoice/payment/subscription/expense/report
 * authority, read-only on clients and projects, no team administration.
 */
const FINANCE: Permission[] = [
  'workspace:read',
  'team:read',

  'client:read',
  'client:read_sensitive',
  'client:export',

  'project:read',
  'project:read_all',
  'task:read',

  'invoice:read',
  'invoice:create',
  'invoice:update',
  'invoice:issue',
  'invoice:send',
  'invoice:void',
  // Deleting is guarded to drafts at the action level, so a Finance user can
  // discard a draft they raised without being able to erase an issued record.
  'invoice:delete',
  'invoice:download_pdf',
  'payment:read',
  'payment:create',
  'payment:update',
  'payment:delete',
  'creditnote:create',

  'file:read',
  'file:upload',
  'file:download',

  'card:read',
  'card:create',
  'card:update',
  'platform:read',
  'platform:create',
  'platform:update',
  'platformlink:manage',
  'subscription:read',
  'subscription:create',
  'subscription:update',
  'subscription:delete',
  'expense:read',
  'expense:create',
  'expense:update',
  'expense:delete',

  'report:read',
  'report:read_office_finance',
  'report:export',
  'exchangerate:read',
  'exchangerate:manage',

  'settings:read',
  'notification:read',
];

/**
 * Manager: runs delivery. Full client/project/task/file authority.
 * Financial access is restricted by explicit policy: a manager may read
 * invoices (to know what a client was billed) but may not issue, void, or
 * record payments, and has no office-wide finance reporting or card inventory.
 */
const MANAGER: Permission[] = [
  'workspace:read',
  'team:read',

  'client:read',
  'client:read_sensitive',
  'client:create',
  'client:update',
  'client:archive',
  'client:import',
  'client:export',

  'project:read',
  'project:read_all',
  'project:create',
  'project:update',
  'project:manage_members',
  'task:read',
  'task:create',
  'task:update',
  'task:delete',
  'task:comment',

  'invoice:read',
  'invoice:download_pdf',

  'file:read',
  'file:upload',
  'file:update',
  'file:delete',
  'file:download',
  'file:import_data',

  'subscription:read',
  'platform:read',

  'report:read',
  'report:export',

  'settings:read',
  'notification:read',
];

/**
 * Staff: sees only what they are assigned to. No card inventory, no
 * office-wide finance, no client administration.
 */
const STAFF: Permission[] = [
  'workspace:read',
  'team:read',

  'client:read',

  'project:read',
  'task:read',
  'task:create',
  'task:update',
  'task:comment',

  'file:read',
  'file:upload',
  'file:download',

  'notification:read',
  'settings:read',
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  OWNER: ALL,
  ADMIN,
  FINANCE,
  MANAGER,
  STAFF,
};

const ROLE_PERMISSION_SETS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(ROLE_PERMISSIONS.OWNER),
  ADMIN: new Set(ROLE_PERMISSIONS.ADMIN),
  FINANCE: new Set(ROLE_PERMISSIONS.FINANCE),
  MANAGER: new Set(ROLE_PERMISSIONS.MANAGER),
  STAFF: new Set(ROLE_PERMISSIONS.STAFF),
};

/** Deny-by-default capability check. */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSION_SETS[role]?.has(permission) ?? false;
}

export function roleHasAnyPermission(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => roleHasPermission(role, p));
}

/**
 * Roles whose sessions must clear a TOTP challenge. These roles can move money
 * or change who else can.
 */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'FINANCE'];

export function roleRequiresMfa(role: Role): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}

/**
 * Roles that see only the projects and clients they are attached to.
 * Everyone else sees the whole workspace.
 */
export function roleIsScopedToAssignments(role: Role): boolean {
  return !roleHasPermission(role, 'project:read_all');
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  FINANCE: 'Finance',
  MANAGER: 'Manager',
  STAFF: 'Staff',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Full access including workspace configuration and ownership transfer.',
  ADMIN: 'Manages clients, projects, invoices, subscriptions, files and the team.',
  FINANCE: 'Owns invoices, payments, subscription spend and financial reporting.',
  MANAGER: 'Runs client delivery and projects. Limited financial visibility.',
  STAFF: 'Works on assigned projects, clients and files only.',
};

/** Roles a given actor is allowed to assign to someone else. */
export function assignableRoles(actorRole: Role): Role[] {
  switch (actorRole) {
    case 'OWNER':
      return ['OWNER', 'ADMIN', 'FINANCE', 'MANAGER', 'STAFF'];
    case 'ADMIN':
      // An admin may not create another owner, nor promote to admin-equal
      // authority over themselves being removed — admins can manage non-owners.
      return ['FINANCE', 'MANAGER', 'STAFF'];
    default:
      return [];
  }
}
