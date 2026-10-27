/**
 * Human-readable labels for audit actions.
 *
 * Deliberately separate from `lib/audit.ts`: that module reaches for Prisma,
 * `next/headers` and the argon2 binding, none of which may enter a client
 * bundle. Client components (the activity feed, the timeline) import from
 * here instead, so a label lookup never drags the server runtime with it.
 */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.logout': 'Signed out',
  'auth.mfa_enrolled': 'Enabled two-factor authentication',
  'auth.mfa_disabled': 'Disabled two-factor authentication',
  'auth.password_changed': 'Changed password',

  'team.invited': 'Added a team member',
  'team.role_changed': 'Changed a team member role',
  'team.removed': 'Removed a team member',

  'client.created': 'Created client',
  'client.updated': 'Updated client',
  'client.archived': 'Archived client',
  'client.restored': 'Restored client',
  'client.deleted': 'Deleted client',
  'client.imported': 'Imported clients',
  'client.exported': 'Exported clients',

  'project.created': 'Created project',
  'project.updated': 'Updated project',
  'project.deleted': 'Deleted project',
  'project.member_added': 'Added project member',
  'project.member_removed': 'Removed project member',

  'task.created': 'Created task',
  'task.updated': 'Updated task',
  'task.deleted': 'Deleted task',
  'task.commented': 'Commented on task',

  'invoice.created': 'Created invoice',
  'invoice.updated': 'Updated invoice',
  'invoice.issued': 'Issued invoice',
  'invoice.sent': 'Sent invoice',
  'invoice.voided': 'Voided invoice',
  'invoice.cancelled': 'Cancelled invoice',
  'invoice.deleted': 'Deleted draft invoice',
  'invoice.pdf_downloaded': 'Downloaded invoice PDF',

  'payment.created': 'Recorded payment',
  'payment.updated': 'Updated payment',
  'payment.deleted': 'Deleted payment',
  'creditnote.created': 'Issued credit note',

  'card.created': 'Added payment card',
  'card.updated': 'Updated payment card',
  'card.deleted': 'Deleted payment card',

  'platform.created': 'Added platform',
  'platform.updated': 'Updated platform',
  'platform.deleted': 'Deleted platform',

  'platformlink.created': 'Linked card to platform',
  'platformlink.updated': 'Updated card-platform link',
  'platformlink.removed': 'Marked card removed from platform',
  'platformlink.verified': 'Verified card-platform link',

  'subscription.created': 'Created subscription',
  'subscription.updated': 'Updated subscription',
  'subscription.deleted': 'Deleted subscription',

  'expense.created': 'Recorded expense',
  'expense.updated': 'Updated expense',
  'expense.deleted': 'Deleted expense',

  'file.uploaded': 'Uploaded file',
  'file.downloaded': 'Downloaded file',
  'file.updated': 'Updated file',
  'file.deleted': 'Deleted file',
  'file.imported': 'Imported spreadsheet data',

  'report.exported': 'Exported report',
  'exchangerate.created': 'Added exchange rate',
  'exchangerate.deleted': 'Deleted exchange rate',
  'settings.updated': 'Updated workspace settings',
  'job.executed': 'Scheduled job ran',
};

export function auditLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
