import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfig, resetConfigForTest } from '../src/lib/config.js';

function setBaseEnv(): void {
  process.env.REGISTRY_CRON_SECRET = 'test-cron-secret-1234567890';
  process.env.REGISTRY_ADMIN_SECRET = 'test-admin-secret-1234567890';
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
