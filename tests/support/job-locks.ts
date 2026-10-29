import type { JobLock } from '../../packages/core-api/src/core/job-lock';

/**
 * Job lock doubles (#1159) for the schedulers' unit tests. The real lock, Postgres advisory locks
 * across two sessions, is proved in job-lock.integration.ts.
 */

/** This task holds every job's lock: each tick runs here. */
export function heldHere(): JobLock {
  return {
    runExclusive: async (_key, work) => {
      await work();
      return true;
    },
  };
}

/** Another task holds every job's lock: each tick is skipped here. The keys asked for are kept. */
export function heldElsewhere(): JobLock & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    runExclusive: async (key) => {
      keys.push(key);
      return false;
    },
  };
}
