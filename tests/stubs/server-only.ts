/**
 * Test stub for the `server-only` marker package.
 *
 * `server-only` throws unless resolved under React's `react-server`
 * condition, which Vitest's Node transform does not apply. Aliasing it to
 * this empty module lets tests import server modules directly; the real
 * guard still protects the application bundle, where Next does apply the
 * condition.
 */
export {};
