import {
  CLEANUP_BATCH_SIZE,
  NightlyCleanupScheduler,
  deleteInBatches,
  type NightlyCleanupStep,
  type NightlyCleanupStepName,
} from '../../../packages/core-api/src/core/nightly-cleanup';
import { EmailMessageRetention } from '../../../packages/core-api/src/modules/email';
import {
  SYNC_RUNS_KEPT_MONTHS,
  SYNC_RUN_DETAILS_KEPT_DAYS,
  SyncRunDetailsRetention,
  SyncRunRetention,
} from '../../../packages/core-api/src/modules/ingestion/persistence/sync-run-retention';
import { fakeLogger } from '../../support/fake-logger';
import { heldElsewhere, heldHere } from '../../support/job-locks';
import { inMemoryEmailMessages } from '../../support/in-memory-email-messages';

const RUN_HOUR = new Date('2026-10-29T08:05:00.000Z');
const HOUR_MS = 60 * 60_000;

/** A step that records each run's `now` and deletes `count` rows. */
function recordingStep(name: NightlyCleanupStepName, count: number): NightlyCleanupStep & { runs: Date[] } {
  const runs: Date[] = [];
  return {
    name,
    runs,
    purge: (now) => {
      runs.push(now);
      return Promise.resolve(count);
    },
  };
}

function schedulerAt(times: Date[], steps: NightlyCleanupStep[], options: { lockHeld?: boolean } = {}) {
  const logger = fakeLogger();
  let tick = 0;
  const jobLock = options.lockHeld === false ? heldElsewhere() : heldHere();
  const scheduler = new NightlyCleanupScheduler({
    steps,
    jobLock,
    logger,
    now: () => times[Math.min(tick++, times.length - 1)],
  });
  return { scheduler, logger, jobLock };
}

describe('nightly cleanup scheduler', () => {
  it('runs every step once in the 08:00 UTC hour and logs one summary line with each step\'s count', async () => {
    const tokens = recordingStep('refreshTokens', 12);
    const emails = recordingStep('emailMessages', 3);
    const { scheduler, logger } = schedulerAt([RUN_HOUR], [tokens, emails]);

    await scheduler.tick();

    expect(tokens.runs).toEqual([RUN_HOUR]);
    expect(emails.runs).toEqual([RUN_HOUR]);
    expect(logger.info).toHaveBeenCalledWith(
      { action: 'nightlyCleanup.completed', data: { deleted: { refreshTokens: 12, emailMessages: 3 }, failed: [] } },
      'Nightly cleanup completed',
    );
  });

  it('does not run outside the run hour', async () => {
    const step = recordingStep('refreshTokens', 1);
    const { scheduler } = schedulerAt([new Date(RUN_HOUR.getTime() - HOUR_MS), new Date(RUN_HOUR.getTime() + HOUR_MS)], [step]);

    await scheduler.tick();
    await scheduler.tick();

    expect(step.runs).toEqual([]);
  });

  it('runs once a night: later ticks in the run hour skip it, and the next night runs again', async () => {
    const step = recordingStep('refreshTokens', 1);
    const nextNight = new Date(RUN_HOUR.getTime() + 24 * HOUR_MS);
    const { scheduler } = schedulerAt([RUN_HOUR, new Date(RUN_HOUR.getTime() + 15 * 60_000), nextNight], [step]);

    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();

    expect(step.runs).toEqual([RUN_HOUR, nextNight]);
  });

  it('skips the run on a task that does not hold the cleanup\'s job lock', async () => {
    const step = recordingStep('refreshTokens', 1);
    const { scheduler, jobLock } = schedulerAt([RUN_HOUR], [step], { lockHeld: false });

    await scheduler.tick();

    expect(step.runs).toEqual([]);
    expect((jobLock as ReturnType<typeof heldElsewhere>).keys).toEqual(['nightly-cleanup']);
  });

  it('still runs the other steps when one fails, and names the failed step in the summary', async () => {
    const failing: NightlyCleanupStep = { name: 'refreshTokens', purge: () => Promise.reject(new Error('lock timeout')) };
    const emails = recordingStep('emailMessages', 4);
    const { scheduler, logger } = schedulerAt([RUN_HOUR], [failing, emails]);

    await scheduler.tick();

    expect(emails.runs).toEqual([RUN_HOUR]);
    expect(logger.error).toHaveBeenCalledWith(
      { action: 'nightlyCleanup.stepFailed', data: { step: 'refreshTokens', error: 'lock timeout' } },
      expect.any(String),
    );
    expect(logger.info).toHaveBeenCalledWith(
      { action: 'nightlyCleanup.completed', data: { deleted: { emailMessages: 4 }, failed: ['refreshTokens'] } },
      'Nightly cleanup completed',
    );
  });
});

describe('deleting in batches', () => {
  it('deletes batch after batch until one comes back short, and returns the total', async () => {
    const batches = [3, 3, 1];
    const limits: number[] = [];

    const total = await deleteInBatches((limit) => {
      limits.push(limit);
      return Promise.resolve(batches.shift() ?? 0);
    }, 3);

    expect(total).toBe(7);
    expect(limits).toEqual([3, 3, 3]);
  });

  it('stops after one empty batch when there is nothing to delete', async () => {
    let calls = 0;

    const total = await deleteInBatches(() => {
      calls++;
      return Promise.resolve(0);
    }, 3);

    expect(total).toBe(0);
    expect(calls).toBe(1);
  });
});

describe('email retention', () => {
  it('deletes emails created more than 13 months ago and keeps newer ones', async () => {
    let now = new Date('2025-09-01T00:00:00.000Z');
    const outbox = inMemoryEmailMessages(() => now);
    const base = {
      templateKey: 'LEAGUE_JOIN_SUCCESS' as const,
      recipientEmail: 'member@gmail.com',
      fromName: 'Office League',
      fromAddress: 'office@qa.example.com',
      status: 'QUEUED' as const,
      subject: 'Welcome',
      textBody: 'Hello',
      htmlBody: '<p>Hello</p>',
      dueAt: now,
    };
    await outbox.record({ ...base, idempotencyKey: 'old' });
    now = new Date('2025-10-01T00:00:00.000Z');
    await outbox.record({ ...base, idempotencyKey: 'kept' });

    const deleted = await new EmailMessageRetention(outbox).purge(new Date('2026-10-29T08:00:00.000Z'));

    expect(deleted).toBe(1);
    expect(outbox.rows.map((row) => row.idempotencyKey)).toEqual(['kept']);
  });
});

describe('sync-run retention', () => {
  const NOW = new Date('2026-10-29T08:00:00.000Z');

  it('clears run details in the week of submissions that just passed 30 days, batch by batch', async () => {
    const batches = [1000, 1000, 12];
    const clearDetailsBatchSubmittedBetween = jest.fn((_from: Date, _before: Date, _limit: number) =>
      Promise.resolve(batches.shift() ?? 0));

    const cleared = await new SyncRunDetailsRetention({ clearDetailsBatchSubmittedBetween }).purge(NOW);

    expect(cleared).toBe(2012);
    expect(clearDetailsBatchSubmittedBetween).toHaveBeenCalledTimes(3);
    expect(clearDetailsBatchSubmittedBetween).toHaveBeenCalledWith(
      new Date('2026-09-22T08:00:00.000Z'),
      new Date('2026-09-29T08:00:00.000Z'),
      CLEANUP_BATCH_SIZE,
    );
  });

  it('deletes runs submitted before the same day a year ago', async () => {
    const deleteBatchSubmittedBefore = jest.fn((_before: Date, _limit: number) => Promise.resolve(0));

    const deleted = await new SyncRunRetention({ deleteBatchSubmittedBefore }).purge(NOW);

    expect(deleted).toBe(0);
    expect(deleteBatchSubmittedBefore).toHaveBeenCalledWith(new Date('2025-10-29T08:00:00.000Z'), CLEANUP_BATCH_SIZE);
  });

  it('keeps details 30 days and runs 12 months, under their own names in the summary line', () => {
    expect(SYNC_RUN_DETAILS_KEPT_DAYS).toBe(30);
    expect(SYNC_RUNS_KEPT_MONTHS).toBe(12);
    expect(new SyncRunDetailsRetention({ clearDetailsBatchSubmittedBetween: jest.fn() }).name).toBe('syncRunDetails');
    expect(new SyncRunRetention({ deleteBatchSubmittedBefore: jest.fn() }).name).toBe('syncRuns');
  });
});
