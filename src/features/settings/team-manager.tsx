'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Copy, KeyRound, ShieldCheck, ShieldOff, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { Role } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/field';
import { Avatar, Tooltip } from '@/components/ui/misc';
import { Callout } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ROLE_LABELS } from '@/lib/permissions';
import { formatDate } from '@/lib/dates';
import { changeTeamMemberRole, inviteTeamMember, removeTeamMember } from './actions';

interface Member {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  role: Role;
  joinedAt: Date;
}

export function TeamManager({
  members,
  currentUserId,
  assignableRoles,
  permissions,
}: {
  members: Member[];
  currentUserId: string;
  assignableRoles: Role[];
  permissions: { invite: boolean; updateRole: boolean; remove: boolean };
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<Member | null>(null);
  const [pendingRole, setPendingRole] = React.useState<{ member: Member; role: Role } | null>(null);

  async function applyRoleChange() {
    if (!pendingRole) return;
    const result = await changeTeamMemberRole({
      userId: pendingRole.member.id,
      role: pendingRole.role,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${pendingRole.member.name} is now ${ROLE_LABELS[pendingRole.role]}`, {
      description: 'Their active sessions were ended.',
    });
    setPendingRole(null);
    router.refresh();
  }

  async function handleRemove() {
    if (!removeTarget) return;
    const result = await removeTeamMember({ userId: removeTarget.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${removeTarget.name} removed from the workspace`);
    setRemoveTarget(null);
    router.refresh();
  }

  return (
    <>
      {permissions.invite ? (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus /> Add a team member
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-[var(--line)]">
            {members.map((member) => {
              const isSelf = member.id === currentUserId;
              const canChangeThisRole =
                permissions.updateRole && assignableRoles.length > 0 && !isSelf;

              return (
                <li key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar name={member.name} color={member.avatarColor} size="md" />

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-ink truncate text-sm font-medium">{member.name}</span>
                      {isSelf ? (
                        <Badge tone="brand" size="sm">
                          you
                        </Badge>
                      ) : null}
                      {member.status !== 'ACTIVE' ? (
                        <Badge tone="warning" size="sm">
                          {member.status.toLowerCase()}
                        </Badge>
                      ) : null}
                      <Tooltip
                        content={
                          member.mfaEnabled
                            ? 'Two-factor authentication is enrolled.'
                            : 'Not enrolled in two-factor authentication. Owner, Admin and Finance accounts should enrol.'
                        }
                      >
                        <span>
                          {member.mfaEnabled ? (
                            <Badge tone="success" size="sm">
                              <ShieldCheck className="size-2.5" aria-hidden /> 2FA
                            </Badge>
                          ) : (
                            <Badge tone="outline" size="sm">
                              <ShieldOff className="size-2.5" aria-hidden /> no 2FA
                            </Badge>
                          )}
                        </span>
                      </Tooltip>
                    </p>
                    <p className="text-ink-subtle truncate text-xs">
                      {member.email} · joined {formatDate(member.joinedAt)}
                      {member.lastLoginAt
                        ? ` · last signed in ${formatDate(member.lastLoginAt)}`
                        : ' · never signed in'}
                    </p>
                  </div>

                  {canChangeThisRole ? (
                    <Select
                      aria-label={`Role for ${member.name}`}
                      value={member.role}
                      onChange={(e) => setPendingRole({ member, role: e.target.value as Role })}
                      className="h-8 w-auto text-[13px]"
                    >
                      {/* The current role must stay selectable even when the
                          actor could not assign it afresh. */}
                      {[...new Set([member.role, ...assignableRoles])].map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge tone="outline">{ROLE_LABELS[member.role]}</Badge>
                  )}

                  {permissions.remove && !isSelf ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${member.name}`}
                      onClick={() => setRemoveTarget(member)}
                    >
                      <UserMinus className="text-danger" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        assignableRoles={assignableRoles}
      />

      <ConfirmDialog
        open={pendingRole !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRole(null);
        }}
        tone="default"
        title={`Change ${pendingRole?.member.name ?? ''} to ${
          pendingRole ? ROLE_LABELS[pendingRole.role] : ''
        }?`}
        description="This changes what they can see and do immediately, and ends their active sessions so the new permissions take effect at once."
        confirmLabel="Change role"
        onConfirm={applyRoleChange}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRemoveTarget(null);
        }}
        title={`Remove ${removeTarget?.name ?? 'this person'}?`}
        description="They lose access immediately and their sessions end. Their name stays on the invoices, payments and audit entries they created, so the history remains complete."
        confirmLabel="Remove from workspace"
        confirmPhrase={removeTarget?.name}
        onConfirm={handleRemove}
      />
    </>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  assignableRoles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignableRoles: Role[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<Role>(assignableRoles[0] ?? 'STAFF');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<{ email: string; password: string | null } | null>(
    null,
  );

  function reset() {
    setName('');
    setEmail('');
    setError(null);
    setCreated(null);
  }

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      const result = await inviteTeamMember({ name, email, role });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated({ email, password: result.data.temporaryPassword });
      toast.success('Team member added');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copyPassword() {
    if (!created?.password) return;
    try {
      await navigator.clipboard.writeText(created.password);
      toast.success('Copied to the clipboard');
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a team member</DialogTitle>
          <DialogDescription>
            Creates the account straight away. No email is sent — pass the temporary password on
            yourself.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {error ? <Callout tone="danger">{error}</Callout> : null}

          {created ? (
            <>
              <Callout tone="success" title="Account created">
                {created.password ? (
                  <>
                    Give <strong>{created.email}</strong> this temporary password. It is shown once
                    and stored only as a hash — it cannot be recovered later. Ask them to change it
                    after signing in.
                  </>
                ) : (
                  <>
                    <strong>{created.email}</strong> already had an account, so their existing
                    password still applies. They now have access to this workspace.
                  </>
                )}
              </Callout>

              {created.password ? (
                <div className="border-line bg-surface-sunken flex items-center gap-2 rounded-lg border px-3 py-2.5">
                  <KeyRound className="text-ink-subtle size-4 shrink-0" aria-hidden />
                  <code className="text-ink min-w-0 flex-1 font-mono text-sm break-all">
                    {created.password}
                  </code>
                  <Button variant="secondary" size="sm" onClick={copyPassword}>
                    <Copy /> Copy
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <Field label="Full name" required htmlFor="invite-name">
                <Input
                  id="invite-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </Field>

              <Field label="Email address" required htmlFor="invite-email">
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@office.com"
                />
              </Field>

              <Field
                label="Role"
                required
                htmlFor="invite-role"
                hint="Owner, Admin and Finance accounts must enrol in two-factor authentication."
              >
                <Select
                  id="invite-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {assignableRoles.map((option) => (
                    <option key={option} value={option}>
                      {ROLE_LABELS[option]}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            {created ? 'Done' : 'Cancel'}
          </Button>
          {!created ? (
            <Button onClick={handleSubmit} loading={busy} disabled={!name.trim() || !email.trim()}>
              Create account
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
