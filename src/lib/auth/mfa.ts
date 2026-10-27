import { randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { hashPassword, verifyPassword } from './crypto';

/**
 * Time-based one-time passwords (RFC 6238).
 *
 * Required for Owner, Admin and Finance roles — the roles that can move money
 * or change who else can. Secrets are encrypted at rest by the caller before
 * they reach the database (see `crypto.encryptSecret`).
 */

const ISSUER = 'Nexora OS';
const PERIOD = 30;
const DIGITS = 6;
/** Accept the adjacent step either side, covering modest clock drift. */
const WINDOW = 1;

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totpFor(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
}

export function totpUri(secretBase32: string, accountEmail: string): string {
  return totpFor(secretBase32, accountEmail).toString();
}

export async function totpQrDataUrl(secretBase32: string, accountEmail: string): Promise<string> {
  return QRCode.toDataURL(totpUri(secretBase32, accountEmail), {
    margin: 1,
    width: 220,
    errorCorrectionLevel: 'M',
  });
}

/** Validate a submitted 6-digit code. */
export function verifyTotp(secretBase32: string, token: string, accountEmail = 'user'): boolean {
  const normalised = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalised)) return false;
  const delta = totpFor(secretBase32, accountEmail).validate({ token: normalised, window: WINDOW });
  return delta !== null;
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

const RECOVERY_CODE_COUNT = 10;

/** Human-friendly single-use codes, shown once at enrolment. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hashPassword(code)));
}

/**
 * Consume a recovery code. Returns the remaining hashes when the code matched,
 * or null when it did not — the caller persists the reduced list so a code can
 * never be used twice.
 */
export async function consumeRecoveryCode(
  hashes: string[],
  submitted: string,
): Promise<string[] | null> {
  const normalised = submitted.trim().toUpperCase();
  for (const [index, hash] of hashes.entries()) {
    if (await verifyPassword(hash, normalised)) {
      return hashes.filter((_, i) => i !== index);
    }
  }
  return null;
}
