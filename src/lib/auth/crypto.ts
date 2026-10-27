import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { env } from '@/lib/env';

/**
 * Cryptographic primitives for authentication.
 *
 * Passwords: argon2id with OWASP-recommended parameters.
 * Session tokens: 32 random bytes, stored only as a SHA-256 digest.
 * TOTP secrets: AES-256-GCM, key derived from AUTH_SECRET via HKDF.
 */

// OWASP Password Storage Cheat Sheet, argon2id configuration.
const ARGON_OPTIONS = {
  // 19 MiB
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  algorithm: 2, // Argon2id
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hashValue, plain);
  } catch {
    // Malformed hash — treat as a failed verification, never as success.
    return false;
  }
}

/** Opaque, URL-safe random token. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** One-way digest used for anything we must look up but never read back. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison of two hex digests of equal length. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Hash an IP address for audit records. We need to recognise repeat offenders
 * without storing personal data in plaintext, so the address is salted with
 * AUTH_SECRET before hashing.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${env.AUTH_SECRET}:${ip}`).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// Symmetric encryption for secrets at rest (TOTP seeds, integration tokens)
// ---------------------------------------------------------------------------

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (!cachedKey) {
    cachedKey = Buffer.from(
      hkdfSync('sha256', Buffer.from(env.AUTH_SECRET), Buffer.alloc(0), Buffer.from('nexora:aes'), 32),
    );
  }
  return cachedKey;
}

/** AES-256-GCM. Output format: v1.<iv>.<tag>.<ciphertext>, all base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Malformed encrypted payload');
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * HMAC-style signed payload used for short-lived download tokens.
 * Format: <base64url(json)>.<base64url(sig)>
 */
export function signPayload(payload: Record<string, unknown>, purpose: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHash('sha256').update(`${purpose}:${env.AUTH_SECRET}:${body}`).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySignedPayload<T = Record<string, unknown>>(
  token: string,
  purpose: string,
): T | null {
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = createHash('sha256')
    .update(`${purpose}:${env.AUTH_SECRET}:${body}`)
    .digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
