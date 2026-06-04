import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfig, resetConfigForTest } from '../src/lib/config.js';

function setBaseEnv(): void {
  // Strong, non-placeholder secrets (>=32 chars) so the production
  // secret-strength guard is satisfied; individual tests override these
  // to assert the guard rejects weak values.
  process.env.REGISTRY_CRON_SECRET = 'c7f3a9e1b5d28406c9a1f4e7b2d6803a5c9e1f4b';
  process.env.REGISTRY_ADMIN_SECRET = '9b2e4f7a1c8d05369e7b3a1f6c4d8092b5e1a7f3';
  process.env.DATABASE_URL = 'postgres://x:x@localhost:5432/x';
  process.env.REDIS_URL = 'redis://localhost:6379';
}

describe('REGISTRY_E2E_DIRECT_INSERT production guard', () => {
  beforeEach(() => {
    setBaseEnv();
    resetConfigForTest();
  });
  afterEach(() => {
    delete process.env.REGISTRY_E2E_DIRECT_INSERT;
    delete process.env.NODE_ENV;
    resetConfigForTest();
  });

  it('refuses to boot when NODE_ENV=production and REGISTRY_E2E_DIRECT_INSERT=1', () => {
    process.env.NODE_ENV = 'production';
    process.env.REGISTRY_E2E_DIRECT_INSERT = '1';
    resetConfigForTest();
    expect(() => getConfig()).toThrow(/REGISTRY_E2E_DIRECT_INSERT/);
  });

  it('refuses to boot when NODE_ENV=production and REGISTRY_E2E_DIRECT_INSERT=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.REGISTRY_E2E_DIRECT_INSERT = 'true';
    resetConfigForTest();
    expect(() => getConfig()).toThrow(/REGISTRY_E2E_DIRECT_INSERT/);
  });

  it('allows REGISTRY_E2E_DIRECT_INSERT=1 in non-production envs', () => {
    process.env.NODE_ENV = 'test';
    process.env.REGISTRY_E2E_DIRECT_INSERT = '1';
    resetConfigForTest();
    expect(getConfig().REGISTRY_E2E_DIRECT_INSERT).toBe(true);

    process.env.NODE_ENV = 'development';
    resetConfigForTest();
    expect(getConfig().REGISTRY_E2E_DIRECT_INSERT).toBe(true);
  });

  it('allows NODE_ENV=production when the flag is unset or 0', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REGISTRY_E2E_DIRECT_INSERT;
    resetConfigForTest();
    expect(getConfig().REGISTRY_E2E_DIRECT_INSERT).toBe(false);

    process.env.REGISTRY_E2E_DIRECT_INSERT = '0';
    resetConfigForTest();
    expect(getConfig().REGISTRY_E2E_DIRECT_INSERT).toBe(false);
  });
});

describe('production secret-strength guard', () => {
  beforeEach(() => {
    setBaseEnv();
    resetConfigForTest();
  });
  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.REGISTRY_E2E_DIRECT_INSERT;
    resetConfigForTest();
  });

  it('refuses to boot in production with the published placeholder cron secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.REGISTRY_CRON_SECRET = 'change-me-in-prod';
    resetConfigForTest();
    expect(() => getConfig()).toThrow(/REGISTRY_CRON_SECRET/);
  });

  it('refuses to boot in production with the published placeholder admin secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.REGISTRY_ADMIN_SECRET = 'change-me-in-prod';
    resetConfigForTest();
    expect(() => getConfig()).toThrow(/REGISTRY_ADMIN_SECRET/);
  });

  it('refuses to boot in production with a long but placeholder-worded secret', () => {
    process.env.NODE_ENV = 'production';
    // 36 chars — long enough to pass a naive length check, but a known placeholder.
    process.env.REGISTRY_CRON_SECRET = 'replace-me-with-a-long-random-string';
    resetConfigForTest();
    expect(() => getConfig()).toThrow(/REGISTRY_CRON_SECRET/);
  });

  it('refuses to boot in production with a secret shorter than 32 chars', () => {
    process.env.NODE_ENV = 'production';
    process.env.REGISTRY_CRON_SECRET = 'abcd1234efgh5678'; // 16 chars, passes min(16)
    resetConfigForTest();
    expect(() => getConfig()).toThrow(/REGISTRY_CRON_SECRET/);
  });

  it('boots in production with strong, non-placeholder secrets', () => {
    process.env.NODE_ENV = 'production';
    resetConfigForTest();
    expect(() => getConfig()).not.toThrow();
  });

  it('allows short/placeholder secrets outside production (dev convenience)', () => {
    process.env.NODE_ENV = 'development';
    process.env.REGISTRY_CRON_SECRET = 'change-me-in-prod';
    process.env.REGISTRY_ADMIN_SECRET = 'change-me-in-prod';
    resetConfigForTest();
    expect(() => getConfig()).not.toThrow();
  });
});
