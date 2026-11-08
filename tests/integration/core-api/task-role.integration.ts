/**
 * #1186: one image, three task roles. This boots the real app (`buildApp`) as each role and checks
 * which background loops it starts, and whether an email a request queues wakes this task's sender
 * or waits for the worker's. The loops' own work is stubbed out, since this tests the choice of
 * what runs, not the loops; the email itself is recorded in Postgres as in any other request.
 */
import { expect, jest } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { createTestUser, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { BackgroundJobQueue, BackgroundJobRunner } from '../../../packages/core-api/src/modules/background-jobs';
import { EmailSender } from '../../../packages/core-api/src/modules/email';
import { EventLifecycleScheduler } from '../../../packages/core-api/src/modules/events/event-lifecycle-scheduler';
import { NightlyCleanupScheduler } from '../../../packages/core-api/src/core/nightly-cleanup';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core';

let savedEnv: NodeJS.ProcessEnv;
let app: FastifyInstance | undefined;

const realSenderStart = EmailSender.prototype.start;

function stubLoops() {
  const senderTicks: (number | undefined)[] = [];
  // The sender's real start, so the tick its timer gets is the one the app wired; its drain does
  // nothing, and the timer is stopped at once.
  jest.spyOn(EmailSender.prototype, 'drain').mockResolvedValue(undefined);
  const emailSender = jest.spyOn(EmailSender.prototype, 'start').mockImplementation(function startOnce(this: EmailSender) {
    const timers = jest.spyOn(global, 'setInterval');
    try {
      realSenderStart.call(this);
      senderTicks.push(timers.mock.calls.at(-1)?.[1]);
    } finally {
      timers.mockRestore();
      this.stop();
    }
  });
  return {
    senderTicks,
    jobRunner: jest.spyOn(BackgroundJobRunner.prototype, 'start').mockImplementation(() => undefined),
    emailSender,
    lifecycleSweep: jest.spyOn(EventLifecycleScheduler.prototype, 'start').mockImplementation(() => undefined),
    nightlyCleanup: jest.spyOn(NightlyCleanupScheduler.prototype, 'start').mockImplementation(() => undefined),
    ingestion: jest.spyOn(IngestionScheduler.prototype, 'start').mockImplementation(() => undefined),
    senderWake: jest.spyOn(EmailSender.prototype, 'wake').mockImplementation(() => undefined),
    runnerWiredToQueue: jest.spyOn(BackgroundJobQueue.prototype, 'wakes'),
  };
}

async function bootAs(role: string | undefined): Promise<FastifyInstance> {
  if (role === undefined) delete process.env.CORE_API_ROLE;
  else process.env.CORE_API_ROLE = role;
  // Ingestion is otherwise off in tests; on here, so only the role decides whether it starts.
  process.env.AUTO_START_SCHEDULER = 'true';
  // Importing the entry point would otherwise start a listening server.
  process.env.POOLMASTER_DISABLE_AUTO_START = 'true';
  const { buildApp } = await import('../../../packages/core-api/src/index');
  app = buildApp();
  await app.ready();
  return app;
}

function started(loops: ReturnType<typeof stubLoops>) {
  return {
    jobRunner: loops.jobRunner.mock.calls.length > 0,
    emailSender: loops.emailSender.mock.calls.length > 0,
    lifecycleSweep: loops.lifecycleSweep.mock.calls.length > 0,
    nightlyCleanup: loops.nightlyCleanup.mock.calls.length > 0,
    ingestion: loops.ingestion.mock.calls.length > 0,
  };
}

/** Asks for a reset link for a new user and resolves once its email is recorded, queued. */
async function queueResetEmail(server: FastifyInstance): Promise<void> {
  const { user } = await createTestUser();
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/password-reset/request',
    payload: { identifier: user.email },
  });
  expect(response.statusCode).toBe(202);
  // The email is queued after the reply; wait for its row.
  for (let poll = 0; poll < 100; poll++) {
    // poolmaster-allow-query-in-loop: test polling for one row, bounded
    const message = await getPrisma().emailMessage.findFirst({ where: { recipientUserId: user.id } });
    if (message) {
      expect(message.status).toBe('QUEUED');
      // The service calls its queued hook straight after the write; let it run.
      await new Promise((resolve) => { setTimeout(resolve, 50); });
      return;
    }
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
  throw new Error('The reset email was never recorded');
}

const ALL_LOOPS = { jobRunner: true, emailSender: true, lifecycleSweep: true, nightlyCleanup: true, ingestion: true };
const NO_LOOPS = { jobRunner: false, emailSender: false, lifecycleSweep: false, nightlyCleanup: false, ingestion: false };

beforeAll(async () => {
  await setupIntegrationTests();
  // After setup, which sets the secrets and mail settings every boot below needs.
  savedEnv = { ...process.env };
});

afterAll(async () => {
  await teardownIntegrationTests();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
  process.env = { ...savedEnv };
});

describe('core-api task roles', () => {
  it('runs every background loop, and wakes its own sender and runner, when no role is set, as QA runs today', async () => {
    const loops = stubLoops();
    const server = await bootAs(undefined);

    await queueResetEmail(server);

    expect(started(loops)).toEqual(ALL_LOOPS);
    expect(loops.runnerWiredToQueue).toHaveBeenCalledTimes(1);
    expect(loops.senderWake).toHaveBeenCalled();
    // The sender's default tick: a wake, not the timer, sends a request's email here.
    expect(loops.senderTicks).toEqual([15_000]);
  });

  it('starts no background loop on an API-only task, and leaves the email a request queues for the worker', async () => {
    const loops = stubLoops();
    const server = await bootAs('api');

    await queueResetEmail(server);

    expect(started(loops)).toEqual(NO_LOOPS);
    expect(loops.runnerWiredToQueue).not.toHaveBeenCalled();
    expect(loops.senderWake).not.toHaveBeenCalled();
  });

  it('runs every background loop on a worker, polling for email every second and still waking its own sender and runner', async () => {
    const loops = stubLoops();
    const server = await bootAs('worker');

    await queueResetEmail(server);

    expect(started(loops)).toEqual(ALL_LOOPS);
    expect(loops.runnerWiredToQueue).toHaveBeenCalledTimes(1);
    expect(loops.senderWake).toHaveBeenCalled();
    // Every second, so an email an API task queued goes out within one.
    expect(loops.senderTicks).toEqual([1000]);
  });

  it('refuses to build a task whose role it does not know', async () => {
    stubLoops();
    await expect(bootAs('workers')).rejects.toThrow('CORE_API_ROLE "workers" must be one of all, api, worker.');
  });
});
