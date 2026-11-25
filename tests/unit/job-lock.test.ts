import { PrismaClient } from '@prisma/client';
import { RequiredEnvMissingError } from '../../packages/core-api/src/core/config';
import { PostgresJobLock, jobLockConnectionUrl } from '../../packages/core-api/src/core/job-lock';
import { fakeLogger } from '../support/fake-logger';

// What the lock's own session answers at each tick, in order: true while this task holds the
// lock, false while another task does. Losing the lock depends on session timing against real
// Postgres (the integration suite), so the answers are scripted here instead.
const answers: boolean[] = [];
const queryRaw = jest.fn(() => Promise.resolve([{ held: answers.shift() ?? false }]));
const disconnect = jest.fn(() => Promise.resolve());

jest.mock('@prisma/client', () => ({
  ...jest.requireActual<object>('@prisma/client'),
  PrismaClient: jest.fn(() => ({ $queryRaw: queryRaw, $disconnect: disconnect })),
}));

const DATABASE_URL = 'postgresql://app:secret@db.example:5432/poolmaster';

beforeEach(() => {
  answers.length = 0;
  queryRaw.mockClear();
  disconnect.mockClear();
  jest.mocked(PrismaClient).mockClear();
});

/** Runs one tick of `key` on the lock, and says whether the work ran. */
async function tick(lock: PostgresJobLock, key: string, held: boolean): Promise<boolean> {
  answers.push(held);
  let ran = false;
  const result = await lock.runExclusive(key, () => {
    ran = true;
    return Promise.resolve();
  });
  expect(result).toBe(ran);
  return ran;
}

describe('PostgresJobLock', () => {
  it('logs taking a job lock once, however many ticks keep holding it, and runs the job each tick', async () => {
    const logger = fakeLogger();
    const lock = new PostgresJobLock(DATABASE_URL, logger);

    expect(await tick(lock, 'sweep', true)).toBe(true);
    expect(await tick(lock, 'sweep', true)).toBe(true);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ key: 'sweep' }, 'This task took a background job lock and now runs the job');
  });

  it('warns once when a held lock is lost, stops running the job, and stays quiet while another task keeps it', async () => {
    const logger = fakeLogger();
    const lock = new PostgresJobLock(DATABASE_URL, logger);
    await tick(lock, 'sweep', true);

    expect(await tick(lock, 'sweep', false)).toBe(false);
    expect(await tick(lock, 'sweep', false)).toBe(false);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith({ key: 'sweep' }, 'This task lost a background job lock and no longer runs the job');
  });

  it('logs taking the lock again after a close, since closing gave up every lock', async () => {
    const logger = fakeLogger();
    const lock = new PostgresJobLock(DATABASE_URL, logger);
    await tick(lock, 'sweep', true);

    await lock.close();
    await tick(lock, 'sweep', true);

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it('opens one connection of its own for all its keys and ticks', async () => {
    const lock = new PostgresJobLock(DATABASE_URL);

    await tick(lock, 'sweep', true);
    await tick(lock, 'sync', false);

    expect(PrismaClient).toHaveBeenCalledTimes(1);
    expect(PrismaClient).toHaveBeenCalledWith({ datasourceUrl: jobLockConnectionUrl(DATABASE_URL) });
  });

  it('takes and loses locks without a logger', async () => {
    const lock = new PostgresJobLock(DATABASE_URL);

    expect(await tick(lock, 'sweep', true)).toBe(true);
    expect(await tick(lock, 'sweep', false)).toBe(false);
  });

  it('closes without error when it never connected', async () => {
    await new PostgresJobLock(DATABASE_URL).close();

    expect(disconnect).not.toHaveBeenCalled();
  });

  it('refuses to run a job without a database URL, naming the missing setting, and runs nothing', async () => {
    const work = jest.fn(() => Promise.resolve());

    await expect(new PostgresJobLock(undefined).runExclusive('sweep', work)).rejects.toThrow(RequiredEnvMissingError);
    expect(work).not.toHaveBeenCalled();
  });
});

describe('jobLockConnectionUrl', () => {
  it('keeps the app database and limits its pool to one connection that never idles out', () => {
    const url = new URL(jobLockConnectionUrl(`${DATABASE_URL}?schema=public`));

    expect(url.host).toBe('db.example:5432');
    expect(url.searchParams.get('schema')).toBe('public');
    expect(url.searchParams.get('connection_limit')).toBe('1');
    expect(url.searchParams.get('max_idle_connection_lifetime')).toBe(String(365 * 24 * 60 * 60));
  });
});
