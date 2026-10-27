import { z } from 'zod';

/**
 * Environment validation.
 *
 * Parsed once at module load. A misconfigured deployment fails immediately
 * and loudly rather than halfway through a request.
 */

const boolish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .transform((v) => v === true || v === 'true' || v === '1')
  .default(false);

const serverSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    APP_URL: z.url().default('http://localhost:3000'),
    AUTH_SECRET: z
      .string()
      .min(32, 'AUTH_SECRET must be at least 32 characters. Generate: openssl rand -base64 48'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: boolish,

    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(26_214_400),

    EMAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: boolish,
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default('Nexora OS <no-reply@example.com>'),

    CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),

    BOOTSTRAP_OWNER_EMAIL: z.email().optional(),
    BOOTSTRAP_OWNER_NAME: z.string().optional(),
    BOOTSTRAP_OWNER_PASSWORD: z.string().optional(),

    WORKSPACE_NAME: z.string().default('Nexora Office'),
    WORKSPACE_BASE_CURRENCY: z
      .string()
      .regex(/^[A-Z]{3}$/, 'WORKSPACE_BASE_CURRENCY must be a 3-letter ISO 4217 code')
      .default('PKR'),
    WORKSPACE_TIMEZONE: z.string().default('UTC'),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((value, ctx) => {
    if (value.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }
    if (value.EMAIL_DRIVER === 'smtp' && !value.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when EMAIL_DRIVER=smtp',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.AUTH_SECRET.startsWith('replace-me')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET'],
        message: 'AUTH_SECRET still holds the .env.example placeholder',
      });
    }
    if (value.NODE_ENV === 'production' && value.CRON_SECRET.startsWith('replace-me')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CRON_SECRET'],
        message: 'CRON_SECRET still holds the .env.example placeholder',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverSchema>;

function loadEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration.\n${issues}\n\nSee .env.example for the full list.`,
    );
  }
  return parsed.data;
}

export const env: ServerEnv = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
