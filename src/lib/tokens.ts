import { randomBytes } from 'node:crypto';

const ENTROPY_BYTES = 16;

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
