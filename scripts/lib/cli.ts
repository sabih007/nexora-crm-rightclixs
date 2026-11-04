/** Shared helpers for the maintenance scripts in scripts/. */

/** Read `--name=value` from argv. */
export function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
}

/**
 * Describe how a password falls short of the workspace policy.
 * Mirrors the newPassword rules in src/features/auth/actions.ts — keep the
 * two in step, that action is the source of truth the UI enforces.
 */
export function policyFailures(password: string): string[] {
  const failures: string[] = [];
  if (password.length < 12) failures.push('at least 12 characters');
  if (password.length > 200) failures.push('at most 200 characters');
  if (!/[a-z]/.test(password)) failures.push('a lower-case letter');
  if (!/[A-Z]/.test(password)) failures.push('an upper-case letter');
  if (!/\d/.test(password)) failures.push('a number');
  return failures;
}
