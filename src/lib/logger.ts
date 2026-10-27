import { env, isProduction } from './env';

/**
 * Minimal structured logger.
 *
 * Emits single-line JSON in production so a log aggregator can parse it, and
 * human-readable lines in development. Values are redacted by key name before
 * they are written: secrets, tokens and card data must never reach the log.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[env.LOG_LEVEL];

const REDACT_PATTERN =
  /pass(word)?|secret|token|authorization|cookie|cvv|pin\b|pan\b|cardnumber|card_number|apikey|api_key|accesskey|private/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_PATTERN.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level: Level, message: string, context?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
  };

  const line = isProduction
    ? JSON.stringify(payload)
    : `${payload.time} ${level.toUpperCase().padEnd(5)} ${message}` +
      (context ? ` ${JSON.stringify(redact(context))}` : '');

  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => write('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => write('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => write('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => write('error', m, c),
};

/**
 * Hook for an external error monitor (Sentry, Rollbar, …).
 * Wired here so there is exactly one place to add the SDK later.
 */
export function captureException(error: unknown, context?: Record<string, unknown>) {
  logger.error('Unhandled exception', { error, ...context });
}
