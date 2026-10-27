import { spawnSync } from 'node:child_process';

/**
 * Remove the records the E2E run created.
 *
 * The work itself lives in `scripts/e2e-cleanup.ts` and runs in a child
 * process under tsx. Playwright transpiles its config and hooks to CommonJS,
 * and the generated Prisma client is ESM, so importing it directly here fails
 * with "Cannot use 'import.meta' outside a module". Every other database
 * script in this repo already runs under tsx; this follows the same path.
 */
export default function globalTeardown() {
  if (process.env.E2E_KEEP_DATA === '1') {
    console.log('[e2e teardown] E2E_KEEP_DATA=1 — leaving test records in place.');
    return;
  }

  // Spawn node with tsx's own entry point rather than `npx` through a shell:
  // on Windows a .cmd shim needs shell:true, which Node now warns about
  // because the arguments would be concatenated rather than escaped.
  const result = spawnSync(
    process.execPath,
    [require.resolve('tsx/cli'), '--conditions=react-server', 'scripts/e2e-cleanup.ts'],
    { stdio: 'inherit' },
  );

  // A teardown failure must not mask the test result.
  if (result.status !== 0) {
    console.warn(`[e2e teardown] Cleanup exited with status ${result.status}.`);
  }
}
