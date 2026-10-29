import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createFastifyLoggerOptions } from '../../../packages/core-api/src/core/logger';
import { countingQueries, outsideQueryUsage, REQUEST_QUERY_BUDGET, type RequestQueryUsage } from '../../../packages/core-api/src/core/request-query-usage';
import { memoizedRead } from '../../../packages/core-api/src/core/request-read-memo';
import { requestLoggingContext } from '../../../packages/core-api/src/plugins/request-logging-context';
import { requestQueryUsage } from '../../../packages/core-api/src/plugins/request-query-usage';
import { requestReadMemo } from '../../../packages/core-api/src/plugins/request-read-memo';
import { PrismaEmailMessageRepository } from '../../../packages/core-api/src/adapters';
import { EMAIL_SETTINGS, EmailSender } from '../../../packages/core-api/src/modules/email';
import { queryBudgetViolation } from '../../support/query-budget';

// The per-request query budget against Postgres (#1244): each request counts the Prisma queries
// it makes, its log line carries the count and the database time, and a request over the budget
// is logged as a warning and fails the functional suite's check.

interface LogLine {
  level: string;
  msg: string;
  route?: string;
  action?: string;
  data?: { queryCount: number; dbMs: number; budget: number };
  res?: { statusCode: number; queryCount?: number; dbMs?: number };
}

const prisma = countingQueries(new PrismaClient());
let app: FastifyInstance;
let lines: LogLine[];
let lastUsage: RequestQueryUsage | undefined;
const usageByUrl = new Map<string, RequestQueryUsage | undefined>();
let backgroundDone: Promise<void>;
// The app's email sender over the counted client: a request that queues an email wakes it.
const emailSender = new EmailSender({
  messages: new PrismaEmailMessageRepository(prisma),
  transport: { providerName: 'smtp', send: () => Promise.resolve({ provider: 'smtp' }) },
  readConfig: () => EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }),
});

beforeAll(async () => {
  // Required by the logger with no fallback (core/config.ts); setupIntegrationTests sets it the same way.
  process.env.POOLMASTER_ENVIRONMENT ??= 'test';
  lines = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as LogLine);
      done();
    },
  });
  app = Fastify({ logger: { ...createFastifyLoggerOptions('core-api'), level: 'info', stream } });
  await app.register(requestReadMemo);
  await app.register(requestQueryUsage);
  await app.register(requestLoggingContext);
  app.addHook('onResponse', (request, _reply, done) => {
    lastUsage = request.queryUsage;
    usageByUrl.set(request.url, request.queryUsage);
    done();
  });
  app.get<{ Params: { count: string } }>('/queries/:count', async (request) => {
    for (let made = 0; made < Number(request.params.count); made += 1) {
      await prisma.user.count();
    }
    return { ok: true };
  });
  app.get('/memoized', async () => {
    await memoizedRead(prisma, 'query-usage-test', () => prisma.user.count());
    await memoizedRead(prisma, 'query-usage-test', () => prisma.user.count());
    return { ok: true };
  });
  app.get('/transaction', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.user.count();
      await tx.league.count();
    });
    return { ok: true };
  });
  app.get('/batch', async () => {
    await prisma.$transaction([prisma.user.count(), prisma.league.count(), prisma.sport.count()]);
    return { ok: true };
  });
  app.get('/queues-email', async () => {
    await prisma.user.count();
    emailSender.wake();
    return { ok: true };
  });
  app.get('/background', async () => {
    backgroundDone = outsideQueryUsage(() => new Promise<void>((resolve) => {
      setImmediate(() => {
        void prisma.user.count().then(() => resolve());
      });
    }));
    await prisma.user.count();
    return { ok: true };
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  lines.length = 0;
  lastUsage = undefined;
  usageByUrl.clear();
});

function completedLine(): LogLine {
  const line = lines.find((entry) => entry.msg === 'request completed');
  if (line === undefined) {
    throw new Error('No request completed line was logged');
  }
  return line;
}

function budgetWarnings(): LogLine[] {
  return lines.filter((entry) => entry.action === 'request.queryBudget.exceeded');
}

describe('per-request query budget (#1244)', () => {
  it('puts the query count and database time on the request completed log line', async () => {
    await app.inject({ method: 'GET', url: '/queries/3' });

    const { res } = completedLine();
    expect(res?.statusCode).toBe(200);
    expect(res?.queryCount).toBe(3);
    expect(typeof res?.dbMs).toBe('number');
    expect(res?.dbMs).toBeGreaterThanOrEqual(0);
  });

  it(`passes a route that runs exactly the budget of ${REQUEST_QUERY_BUDGET} queries, with no warning`, async () => {
    await app.inject({ method: 'GET', url: `/queries/${REQUEST_QUERY_BUDGET}` });

    expect(lastUsage?.queryCount).toBe(REQUEST_QUERY_BUDGET);
    expect(lastUsage?.overBudget).toBe(false);
    expect(queryBudgetViolation('GET /queries/:count', REQUEST_QUERY_BUDGET, {})).toBeNull();
    expect(budgetWarnings()).toHaveLength(0);
  });

  it('fails a route that runs one query over the budget, naming the route and count, and logs a warning with the route', async () => {
    await app.inject({ method: 'GET', url: `/queries/${REQUEST_QUERY_BUDGET + 1}` });

    expect(lastUsage?.overBudget).toBe(true);
    expect(queryBudgetViolation('GET /queries/:count', lastUsage?.queryCount ?? 0, {})).toEqual({
      route: 'GET /queries/:count',
      queryCount: REQUEST_QUERY_BUDGET + 1,
    });
    const warnings = budgetWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      level: 'WARN',
      route: '/queries/:count',
      data: { queryCount: REQUEST_QUERY_BUDGET + 1, budget: REQUEST_QUERY_BUDGET },
    });
    expect(typeof warnings[0].data?.dbMs).toBe('number');
  });

  it('lets an allow-listed route over the budget pass the check', () => {
    expect(queryBudgetViolation('GET /queries/:count', REQUEST_QUERY_BUDGET + 1, { 'GET /queries/:count': { ticket: 1244 } })).toBeNull();
  });

  it('counts a read the request memo answers once, not once per asker', async () => {
    await app.inject({ method: 'GET', url: '/memoized' });

    expect(lastUsage?.queryCount).toBe(1);
  });

  it('counts each query made through an interactive transaction', async () => {
    await app.inject({ method: 'GET', url: '/transaction' });

    expect(lastUsage?.queryCount).toBe(2);
  });

  it('does not count work the request starts but does not wait for', async () => {
    await app.inject({ method: 'GET', url: '/background' });
    await backgroundDone;

    expect(lastUsage?.queryCount).toBe(1);
  });

  it('counts each statement of a batch transaction', async () => {
    await app.inject({ method: 'GET', url: '/batch' });

    expect(lastUsage?.queryCount).toBe(3);
  });

  it('keeps a separate count for each of two requests running at the same time', async () => {
    await Promise.all([
      app.inject({ method: 'GET', url: '/queries/3' }),
      app.inject({ method: 'GET', url: '/queries/7' }),
    ]);

    expect(usageByUrl.get('/queries/3')?.queryCount).toBe(3);
    expect(usageByUrl.get('/queries/7')?.queryCount).toBe(7);
  });

  it('does not count the email sender\'s drain that a request wakes by queueing an email', async () => {
    await app.inject({ method: 'GET', url: '/queues-email' });
    await emailSender.drain();

    expect(lastUsage?.queryCount).toBe(1);
  });
});
