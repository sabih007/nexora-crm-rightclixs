/**
 * Reset a user's password from the command line.
 *
 *   npm run reset:password -- --email=owner@example.com --password='NewPassw0rd!'
 *
 * Recovery tool for when nobody can sign in to reach Settings → Security.
 * The password is hashed with argon2id, every existing session for the
 * account is revoked, and the change is written to the audit log.
 *
 * Flags:
 *   --clear-mfa  also unenrol two-factor (use when the authenticator is lost)
 *   --force      accept a password that fails the workspace policy
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

import { policyFailures, readFlag } from './lib/cli';

async function main() {
  const { Prisma } = await import('../src/generated/prisma/client');
  const { prisma } = await import('../src/lib/db');
  const { hashPassword } = await import('../src/lib/auth/crypto');
  const { revokeAllUserSessions } = await import('../src/lib/auth/session');
  const { roleRequiresMfa } = await import('../src/lib/permissions');
  const { recordAudit } = await import('../src/lib/audit');

  const email = (readFlag('email') ?? '').trim().toLowerCase();
  const password = readFlag('password') ?? '';
  const clearMfa = process.argv.includes('--clear-mfa');
  const force = process.argv.includes('--force');

  if (!email || !password) {
    console.error(
      "Usage: npm run reset:password -- --email=<email> --password='<password>' [--clear-mfa] [--force]",
    );
    process.exit(1);
  }

  const failures = policyFailures(password);
  if (failures.length > 0 && !force) {
    console.error(`\n  That password does not meet the workspace policy. It needs:`);
    for (const f of failures) console.error(`    • ${f}`);
    console.error('\n  Re-run with --force to set it anyway.\n');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      mfaEnabled: true,
      memberships: { select: { workspaceId: true, role: true } },
    },
  });

  if (!user) {
    console.error(`\n  No account found for ${email}. Nothing was changed.\n`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const membership = user.memberships[0];

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      ...(clearMfa
        ? {
            mfaEnabled: false,
            mfaSecretEnc: null,
            mfaRecoveryCodes: Prisma.DbNull,
            mfaEnrolledAt: null,
          }
        : {}),
    },
  });

  // A reset invalidates every session; the CLI holds none to preserve.
  await revokeAllUserSessions(user.id);

  if (membership) {
    await recordAudit({
      workspaceId: membership.workspaceId,
      actorId: user.id,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: user.id,
      summary: clearMfa
        ? 'Password reset via CLI; two-factor unenrolled; all sessions signed out'
        : 'Password reset via CLI; all sessions signed out',
    });
  }

  const role = membership?.role ?? null;
  console.log('\n  ──────────────────────────────────────────────────────────');
  console.log('   Password reset');
  console.log('  ──────────────────────────────────────────────────────────');
  console.log(`   Name      : ${user.name}`);
  console.log(`   Email     : ${user.email}`);
  console.log(`   Role      : ${role ?? '(no workspace membership)'}`);
  console.log(`   Status    : ${user.status}`);
  console.log(
    `   Two-factor: ${clearMfa ? 'unenrolled — set it up again at sign-in' : user.mfaEnabled ? 'still enabled — you will need your authenticator code' : 'not enabled'}`,
  );
  console.log('   Sessions  : all signed out');
  if (failures.length > 0) {
    console.log(
      `\n   Policy overridden with --force. This password fails: ${failures.join(', ')}.`,
    );
    console.log('   Settings → Security will refuse it on the next change.');
  }
  if (user.status !== 'ACTIVE') {
    console.log(`\n   This account is ${user.status} and cannot sign in until reactivated.`);
  }
  if (role && roleRequiresMfa(role) && (clearMfa || !user.mfaEnabled)) {
    console.log(`\n   ${role} requires two-factor for privileged actions. Enrol from`);
    console.log('   Settings → Profile & security after signing in.');
  }
  console.log('  ──────────────────────────────────────────────────────────\n');

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Password reset failed:', error);
  process.exit(1);
});
