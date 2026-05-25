import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { fetchText } from '../lib/fetch.js';
import { DiscoveryDocSchema } from '../lib/schemas.js';
import type { ListingRecord, Store } from '../lib/store/index.js';

const LOCK_KEY = 'revalidate:lock';
const LOCK_TTL_SECONDS = 600;
const LOCK_HEARTBEAT_INTERVAL_MS = 180_000; // 3 min — well inside the 10 min TTL

const DEFAULTS = {
  staleAfterMs: 24 * 60 * 60 * 1000,
  gracePeriodMs: 30 * 24 * 60 * 60 * 1000,
  batchSize: 100,
  concurrency: 10,
  useLock: true,
} as const;

const RELEASE_LOCK_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  else
    return 0
  end
`;

const REFRESH_LOCK_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('expire', KEYS[1], ARGV[2])
  else
    return 0
  end
`;

export interface RevalidationOptions {
  staleAfterMs?: number;
  gracePeriodMs?: number;
  batchSize?: number;
  concurrency?: number;
  /** Overridable clock for tests. */
  now?: () => Date;
  /** Disable the Redis advisory lock (used in tests). */
  useLock?: boolean;
}

export interface RevalidationResult {
  scheduled: number;
  succeeded: number;
  failed: number;
  graceExpired: number;
  lockHeldByOther: boolean;
  errors: { service_did: string; error: string }[];
}

export async function runRevalidation(
  deps: { store: Store; redis: Redis },
  opts: RevalidationOptions = {},
): Promise<RevalidationResult> {
  const cfg = { ...DEFAULTS, ...opts };
  const now = opts.now ?? (() => new Date());
  const { store, redis } = deps;

  let lockToken: string | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (cfg.useLock) {
    lockToken = randomBytes(16).toString('hex');
    const acquired = await redis.set(LOCK_KEY, lockToken, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (acquired !== 'OK') {
      return emptyResult({ lockHeldByOther: true });
    }
    // Heartbeat: while a tick is running, refresh the lock TTL so a slow
    // tick can't expire mid-run and let a second replica race the same
    // listings (which would double-increment the failure counter and
    // weaken the §7 "≥3 consecutive failures" guarantee).
    heartbeat = setInterval(() => {
      void redis
        .eval(REFRESH_LOCK_SCRIPT, 1, LOCK_KEY, lockToken!, String(LOCK_TTL_SECONDS))
        .catch(() => undefined);
    }, LOCK_HEARTBEAT_INTERVAL_MS);
  }

  try {
    const result = emptyResult();

    const due = await store.listDueForRevalidation(
      new Date(now().getTime() - cfg.staleAfterMs),
      cfg.batchSize,
    );
    result.scheduled = due.length;

    for (let i = 0; i < due.length; i += cfg.concurrency) {
      const batch = due.slice(i, i + cfg.concurrency);
      await Promise.all(
        batch.map(async (rec) => {
          try {
            const outcome = await revalidateOne(store, rec, now());
            if (outcome === 'success') result.succeeded++;
            else result.failed++;
          } catch (err) {
            result.failed++;
            result.errors.push({
              service_did: rec.service_did,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }),
      );
    }

    const expired = await store.listStaleBeyondGrace(
      new Date(now().getTime() - cfg.gracePeriodMs),
      cfg.batchSize,
    );
    for (const rec of expired) {
      await store.softDelete(rec.service_did);
      result.graceExpired++;
    }

    return result;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (cfg.useLock && lockToken) {
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, LOCK_KEY, lockToken);
    }
  }
}

function emptyResult(overrides: Partial<RevalidationResult> = {}): RevalidationResult {
  return {
    scheduled: 0,
    succeeded: 0,
    failed: 0,
    graceExpired: 0,
    lockHeldByOther: false,
    errors: [],
    ...overrides,
  };
}

async function revalidateOne(
  store: Store,
  rec: ListingRecord,
  at: Date,
): Promise<'success' | 'failure'> {
  const resp = await fetchText(rec.discovery_url);
  if (!resp.ok) {
    await store.markRevalidationFailure(rec.service_did, at);
    return 'failure';
  }
  let docJson: unknown;
  try {
    docJson = JSON.parse(resp.body);
  } catch {
    await store.markRevalidationFailure(rec.service_did, at);
    return 'failure';
  }
  const parsed = DiscoveryDocSchema.safeParse(docJson);
  if (!parsed.success) {
    await store.markRevalidationFailure(rec.service_did, at);
    return 'failure';
  }
  if (parsed.data.service_did !== rec.service_did) {
    await store.markRevalidationFailure(rec.service_did, at);
    return 'failure';
  }
  await store.markRevalidationSuccess(rec.service_did, parsed.data, at);
  return 'success';
}
