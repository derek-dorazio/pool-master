import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { REQUEST_QUERY_BUDGET } from '../../../packages/core-api/src/core/request-query-usage';
import { requestQueryUsage } from '../../../packages/core-api/src/plugins/request-query-usage';

// The per-request query budget plugin (#1244) on its own, without the request logging context
// the app registers before it: an over-budget request still warns, on the request's own logger.

interface LogLine {
  level: number;
  action?: string;
  data?: { queryCount: number; budget: number };
}

let app: FastifyInstance;
let lines: LogLine[];

beforeEach(async () => {
  lines = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as LogLine);
      callback();
    },
  });
  app = Fastify({ logger: { level: 'warn', stream } });
  await app.register(requestQueryUsage);
  app.get('/queries/:count', (request) => {
    const { count } = request.params as { count: string };
    for (let i = 0; i < Number(count); i += 1) {
      request.queryUsage?.record(1);
    }
    return { ok: true };
  });
  app.get('/uncounted', (request) => {
    request.queryUsage = undefined;
    return { ok: true };
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const budgetWarnings = () => lines.filter((line) => line.action === 'request.queryBudget.exceeded');

describe('the request query budget plugin', () => {
  it('warns on the request logger, with the count and budget, when a request runs more queries than its budget and no context logger is set', async () => {
    await app.inject({ method: 'GET', url: `/queries/${REQUEST_QUERY_BUDGET + 1}` });

    expect(budgetWarnings()).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ queryCount: REQUEST_QUERY_BUDGET + 1, budget: REQUEST_QUERY_BUDGET }) as unknown }),
    ]);
  });

  it('logs nothing for a request within its budget', async () => {
    await app.inject({ method: 'GET', url: `/queries/${REQUEST_QUERY_BUDGET}` });

    expect(budgetWarnings()).toEqual([]);
  });

  it('logs nothing and still answers when a request has no query count by the time it responds', async () => {
    const response = await app.inject({ method: 'GET', url: '/uncounted' });

    expect(response.statusCode).toBe(200);
    expect(budgetWarnings()).toEqual([]);
  });
});
