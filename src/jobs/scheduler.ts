import cron from 'node-cron';
import type Redis from 'ioredis';
import type { Store } from '../lib/store/index.js';
import { runRevalidation } from './revalidate.js';

const DEFAULT_SCHEDULE = '0 6 * * *';

export interface CronHandle {
  stop: () => void;
}

export function startRevalidationCron(
  deps: { store: Store; redis: Redis },
  schedule = DEFAULT_SCHEDULE,
): CronHandle {
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron schedule: ${schedule}`);
  }
  const task = cron.schedule(
    schedule,
    async () => {
      const tickStart = Date.now();
      console.log('[revalidate] tick start');
      try {
        const result = await runRevalidation(deps);
        const ms = Date.now() - tickStart;
        console.log(`[revalidate] tick ${ms}ms`, JSON.stringify(result));
      } catch (err) {
        console.error('[revalidate] tick failed', err);
      }
    },
    { scheduled: true },
  );
  return { stop: () => task.stop() };
}
