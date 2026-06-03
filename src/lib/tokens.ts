import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ENTROPY_BYTES = 16;

/**
 * Constant-time string comparison for secrets (admin/cron bearer tokens).
 * Both inputs are SHA-256'd to a fixed 32-byte length before comparison,
 * so the comparison neither short-circuits on the first differing byte
 * nor leaks the secret's length (audit #7).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

export function generateToken(prefix: 'ch' | 'sess'): string {
  const body = randomBytes(ENTROPY_BYTES).toString('base64url');
  return `${prefix}_${body}`;
}

export function isChallengeToken(token: string): boolean {
  return /^ch_[A-Za-z0-9_-]{22}$/.test(token);
}

export function isSessionToken(token: string): boolean {
  return /^sess_[A-Za-z0-9_-]{22}$/.test(token);
}
