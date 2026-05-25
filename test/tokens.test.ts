import { describe, expect, it } from 'vitest';
import {
  generateToken,
  isChallengeToken,
  isSessionToken,
} from '../src/lib/tokens.js';

describe('tokens', () => {
  it('generates challenge tokens with the ch_ prefix', () => {
    const token = generateToken('ch');
    expect(token.startsWith('ch_')).toBe(true);
    expect(isChallengeToken(token)).toBe(true);
    expect(isSessionToken(token)).toBe(false);
  });

  it('generates session tokens with the sess_ prefix', () => {
    const token = generateToken('sess');
    expect(token.startsWith('sess_')).toBe(true);
    expect(isSessionToken(token)).toBe(true);
    expect(isChallengeToken(token)).toBe(false);
  });

  it('tokens carry at least 128 bits of entropy (22 url-safe base64 chars)', () => {
    const token = generateToken('ch');
    const body = token.slice('ch_'.length);
    expect(body.length).toBe(22);
    expect(/^[A-Za-z0-9_-]{22}$/.test(body)).toBe(true);
  });

  it('successive tokens are distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateToken('ch'));
    }
    expect(seen.size).toBe(1000);
  });
});
