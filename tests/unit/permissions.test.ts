import { describe, expect, it } from 'vitest';
import type { Role } from '@/generated/prisma/enums';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  assignableRoles,
  roleHasAnyPermission,
  roleHasPermission,
  roleIsScopedToAssignments,
  roleRequiresMfa,
} from '@/lib/permissions';

const ALL_ROLES: Role[] = ['OWNER', 'ADMIN', 'FINANCE', 'MANAGER', 'STAFF'];

describe('permission matrix', () => {
  it('denies an unknown permission for every role', () => {
    for (const role of ALL_ROLES) {
      // Deliberately outside the union — this is what an attacker-supplied
      // string would look like reaching the guard.
      expect(roleHasPermission(role, 'totally:madeup' as never)).toBe(false);
    }
  });

  it('gives the owner every declared permission', () => {
    for (const permission of PERMISSIONS) {
      expect(roleHasPermission('OWNER', permission)).toBe(true);
    }
  });

  it('withholds ownership transfer from everyone but the owner', () => {
    expect(roleHasPermission('OWNER', 'workspace:transfer_ownership')).toBe(true);
    for (const role of ALL_ROLES.filter((r) => r !== 'OWNER')) {
      expect(roleHasPermission(role, 'workspace:transfer_ownership')).toBe(false);
    }
  });

  it('references only declared permissions in every role list', () => {
    const declared = new Set<string>(PERMISSIONS);
    for (const role of ALL_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(declared.has(permission)).toBe(true);
      }
    }
  });

  describe('Finance', () => {
    it('can run the money side', () => {
      for (const p of [
        'invoice:issue',
        'invoice:void',
        'invoice:delete',
        'payment:create',
        'expense:create',
        'subscription:update',
        'report:read_office_finance',
        'exchangerate:manage',
      ] as const) {
        expect(roleHasPermission('FINANCE', p)).toBe(true);
      }
    });

    it('cannot administer the team', () => {
      for (const p of ['team:invite', 'team:update_role', 'team:remove'] as const) {
        expect(roleHasPermission('FINANCE', p)).toBe(false);
      }
    });

    it('cannot create or delete clients and projects', () => {
      for (const p of ['client:create', 'client:delete', 'project:create', 'project:delete'] as const) {
        expect(roleHasPermission('FINANCE', p)).toBe(false);
      }
    });
  });

  describe('Manager', () => {
    it('runs delivery', () => {
      for (const p of [
        'client:create',
        'client:update',
        'project:create',
        'project:update',
        'project:manage_members',
        'task:delete',
        'file:import_data',
      ] as const) {
        expect(roleHasPermission('MANAGER', p)).toBe(true);
      }
    });

    it('has read-only invoice access and no payment authority', () => {
      expect(roleHasPermission('MANAGER', 'invoice:read')).toBe(true);
      for (const p of [
        'invoice:create',
        'invoice:issue',
        'invoice:void',
        'payment:create',
        'creditnote:create',
      ] as const) {
        expect(roleHasPermission('MANAGER', p)).toBe(false);
      }
    });

    it('has no card inventory access and no office-wide finance reporting', () => {
      for (const p of ['card:read', 'card:create', 'report:read_office_finance'] as const) {
        expect(roleHasPermission('MANAGER', p)).toBe(false);
      }
    });
  });

  describe('Staff', () => {
    it('cannot see invoices, payments, cards or office finance', () => {
      for (const p of [
        'invoice:read',
        'payment:read',
        'card:read',
        'expense:read',
        'report:read',
        'report:read_office_finance',
        'audit:read',
      ] as const) {
        expect(roleHasPermission('STAFF', p)).toBe(false);
      }
    });

    it('cannot see sensitive client contact data', () => {
      expect(roleHasPermission('STAFF', 'client:read')).toBe(true);
      expect(roleHasPermission('STAFF', 'client:read_sensitive')).toBe(false);
    });

    it('can work on its own assignments', () => {
      for (const p of ['task:create', 'task:update', 'task:comment', 'file:upload'] as const) {
        expect(roleHasPermission('STAFF', p)).toBe(true);
      }
    });
  });

  it('scopes only Manager-below roles that lack project:read_all', () => {
    expect(roleIsScopedToAssignments('STAFF')).toBe(true);
    for (const role of ['OWNER', 'ADMIN', 'FINANCE', 'MANAGER'] as const) {
      expect(roleIsScopedToAssignments(role)).toBe(false);
    }
  });

  it('requires MFA for the roles that can move money or grant access', () => {
    expect(roleRequiresMfa('OWNER')).toBe(true);
    expect(roleRequiresMfa('ADMIN')).toBe(true);
    expect(roleRequiresMfa('FINANCE')).toBe(true);
    expect(roleRequiresMfa('MANAGER')).toBe(false);
    expect(roleRequiresMfa('STAFF')).toBe(false);
  });

  describe('roleHasAnyPermission', () => {
    it('is true when at least one matches', () => {
      expect(roleHasAnyPermission('STAFF', ['invoice:read', 'task:read'])).toBe(true);
    });
    it('is false when none match', () => {
      expect(roleHasAnyPermission('STAFF', ['invoice:read', 'card:read'])).toBe(false);
    });
    it('is false for an empty list', () => {
      expect(roleHasAnyPermission('OWNER', [])).toBe(false);
    });
  });

  describe('assignableRoles', () => {
    it('lets the owner assign anything', () => {
      expect(assignableRoles('OWNER')).toContain('OWNER');
      expect(assignableRoles('OWNER')).toHaveLength(5);
    });

    it('stops an admin creating another owner or admin', () => {
      const assignable = assignableRoles('ADMIN');
      expect(assignable).not.toContain('OWNER');
      expect(assignable).not.toContain('ADMIN');
    });

    it('gives non-administrative roles nothing to assign', () => {
      for (const role of ['FINANCE', 'MANAGER', 'STAFF'] as const) {
        expect(assignableRoles(role)).toEqual([]);
      }
    });
  });
});
