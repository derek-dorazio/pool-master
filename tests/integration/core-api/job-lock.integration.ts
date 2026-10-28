import { randomUUID } from 'node:crypto';
import { PostgresJobLock } from '../../../packages/core-api/src/core/job-lock';
import { fakeLogger } from '../../support/fake-logger';

// The background job lock (#1159) against real Postgres: each PostgresJobLock is one server
// task, on a session of its own, so two of them contend exactly as two tasks in prod do.

const tasks: PostgresJobLock[] = [];

function serverTask(): PostgresJobLock {
  const task = new PostgresJobLock(process.env.DATABASE_URL, fakeLogger());
  tasks.push(task);
  return task;
}

afterEach(async () => {
  await Promise.all(tasks.splice(0).map((task) => task.close()));
});

/** Runs one tick of the job on the task, and says whether the job ran there. */
async function tick(task: PostgresJobLock, key: string): Promise<boolean> {
  let ran = false;
  const held = await task.runExclusive(key, async () => {
    ran = true;
  });
  expect(held).toBe(ran);
  return ran;
}

describe('the background job lock shared by two server tasks', () => {
  it('runs a job on the first task to take its lock and skips it on the other', async () => {
    const key = `job-${randomUUID()}`;
    const first = serverTask();
    const second = serverTask();

    expect(await tick(first, key)).toBe(true);
    expect(await tick(second, key)).toBe(false);
  });

  it('keeps the job on the task that holds its lock for every later tick, not only the first', async () => {
    const key = `job-${randomUUID()}`;
    const first = serverTask();
    const second = serverTask();

    await tick(first, key);
    for (let i = 0; i < 3; i += 1) {
      expect(await tick(second, key)).toBe(false);
      expect(await tick(first, key)).toBe(true);
    }
  });

  it('skips a job on the other task while its holder is still in the middle of a tick', async () => {
    const key = `job-${randomUUID()}`;
    const first = serverTask();
    const second = serverTask();
    let finishTick!: () => void;
    const longTick = first.runExclusive(key, () => new Promise<void>((resolve) => { finishTick = resolve; }));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await tick(second, key)).toBe(false);
    finishTick();
    expect(await longTick).toBe(true);
  });

  it('hands the job to the other task at its next tick once the holder stops', async () => {
    const key = `job-${randomUUID()}`;
    const first = serverTask();
    const second = serverTask();
    await tick(first, key);

    await first.close();

    expect(await tick(second, key)).toBe(true);
  });

  it('runs two different jobs on two tasks independently', async () => {
    const first = serverTask();
    const second = serverTask();

    expect(await tick(first, `job-${randomUUID()}`)).toBe(true);
    expect(await tick(second, `job-${randomUUID()}`)).toBe(true);
  });

  it('keeps holding the lock after a tick whose work threw, so the job does not move tasks on an error', async () => {
    const key = `job-${randomUUID()}`;
    const first = serverTask();
    const second = serverTask();

    await expect(first.runExclusive(key, async () => { throw new Error('provider down'); })).rejects.toThrow('provider down');

    expect(await tick(second, key)).toBe(false);
    expect(await tick(first, key)).toBe(true);
  });
});
