/**
 * Create the first Owner account.
 *
 *   npm run bootstrap:admin
 *
 * Reads BOOTSTRAP_OWNER_* from the environment. When no password is supplied
 * a strong one is generated and printed exactly once — it is stored only as
 * an argon2id hash, so there is no way to recover it later.
 *
 * Safe to re-run: if the email already exists the script reports and exits
 * without modifying the account.
 */
import { randomBytes } from 'node:crypto';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

async function main() {
  const { prisma } = await import('../src/lib/db');
  const { env } = await import('../src/lib/env');
  const { hashPassword } = await import('../src/lib/auth/crypto');
  const { ensureWorkspace } = await import('../src/lib/workspace');
  const { recordAudit } = await import('../src/lib/audit');

  const email = (env.BOOTSTRAP_OWNER_EMAIL ?? '').trim().toLowerCase();
  if (!email) {
    console.error('BOOTSTRAP_OWNER_EMAIL is not set. Add it to .env.local and retry.');
    process.exit(1);
  }

  const name = env.BOOTSTRAP_OWNER_NAME?.trim() || 'Workspace Owner';
  const generated = !env.BOOTSTRAP_OWNER_PASSWORD;
  const password = env.BOOTSTRAP_OWNER_PASSWORD || generateStrongPassword();

  if (password.length < 12) {
    console.error('BOOTSTRAP_OWNER_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`\n  An account already exists for ${email}. Nothing was changed.`);
    console.log('  To reset its password, use the Team page or an explicit admin reset.\n');
    await prisma.$disconnect();
    return;
  }

  const workspaceId = await ensureWorkspace();

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      status: 'ACTIVE',
      timezone: env.WORKSPACE_TIMEZONE,
      memberships: { create: { workspaceId, role: 'OWNER' } },
    },
  });

  await recordAudit({
    workspaceId,
    actorId: user.id,
    action: 'team.invited',
    entityType: 'User',
    entityId: user.id,
    summary: 'Bootstrap owner account created',
  });

  console.log('\n  ──────────────────────────────────────────────────────────');
  console.log('   Owner account created');
  console.log('  ──────────────────────────────────────────────────────────');
  console.log(`   Workspace : ${env.WORKSPACE_NAME}`);
  console.log(`   Name      : ${name}`);
  console.log(`   Email     : ${email}`);
  if (generated) {
    console.log(`   Password  : ${password}`);
    console.log('\n   Store this now. It is hashed with argon2id and cannot be');
    console.log('   recovered. Change it after signing in.');
  } else {
    console.log('   Password  : (taken from BOOTSTRAP_OWNER_PASSWORD)');
  }
  console.log('\n   Owner accounts must enrol in two-factor authentication');
  console.log('   from Settings → Profile & security before the role can');
  console.log('   be used for privileged actions.');
  console.log('  ──────────────────────────────────────────────────────────\n');

  await prisma.$disconnect();
}

/** 24 characters of base64url entropy — ~144 bits. */
function generateStrongPassword(): string {
  return randomBytes(18).toString('base64url');
}

main().catch(async (error) => {
  console.error('Bootstrap failed:', error);
  process.exit(1);
});
