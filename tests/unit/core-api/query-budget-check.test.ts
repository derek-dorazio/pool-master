import { REQUEST_QUERY_BUDGET } from '../../../packages/core-api/src/core/request-query-usage';
import {
  staleAllowListEntries,
  startQueryBudgetRecorder,
  type QueryBudgetRecorder,
  type QueryBudgetViolation,
  type StaleAllowListEntry,
} from '../../support/query-budget';

// The functional suite's query budget check (#1244): which requests it fails on, and which
// allow-list entries it reports as stale once a full run never saw their route over budget.

const ALLOWED = 'POST /api/v1/events/:eventId/participants';
const ALLOW_LIST = { [ALLOWED]: { ticket: 1252 } };

describe('functional query budget check (#1244)', () => {
  let recorder: QueryBudgetRecorder;

  beforeEach(async () => {
    recorder = await startQueryBudgetRecorder(ALLOW_LIST);
  });

  afterEach(async () => {
    await recorder.close();
  });

  async function take(): Promise<QueryBudgetViolation[]> {
    const response = await fetch(`${recorder.url}/take`, { method: 'POST' });
    return (await response.json()) as QueryBudgetViolation[];
  }

  async function stale(): Promise<StaleAllowListEntry[]> {
    const response = await fetch(`${recorder.url}/stale`);
    return ((await response.json()) as { stale: StaleAllowListEntry[] }).stale;
  }

  it('hands over each request over budget once, and nothing for one at the budget or an allowed route', async () => {
    recorder.observe('GET /api/v1/leagues/:id', REQUEST_QUERY_BUDGET);
    recorder.observe('GET /api/v1/leagues', REQUEST_QUERY_BUDGET + 1);
    recorder.observe(ALLOWED, REQUEST_QUERY_BUDGET + 50);

    expect(await take()).toEqual([{ route: 'GET /api/v1/leagues', queryCount: REQUEST_QUERY_BUDGET + 1 }]);
    expect(await take()).toEqual([]);
  });

  it('reports an allow-list entry as stale when its route was not called', async () => {
    expect(await stale()).toEqual([{ route: ALLOWED, ticket: 1252, mostQueries: null }]);
  });

  it('reports an allow-list entry as stale when its route never went over budget', async () => {
    recorder.observe(ALLOWED, 3);
    recorder.observe(ALLOWED, REQUEST_QUERY_BUDGET);

    expect(await stale()).toEqual([{ route: ALLOWED, ticket: 1252, mostQueries: REQUEST_QUERY_BUDGET }]);
  });

  it('keeps an allow-list entry whose route went over budget at least once', async () => {
    recorder.observe(ALLOWED, 3);
    recorder.observe(ALLOWED, REQUEST_QUERY_BUDGET + 1);
    recorder.observe(ALLOWED, 3);

    expect(await stale()).toEqual([]);
  });

  it('lists only the stale entries of a longer allow-list', () => {
    const seen = new Map([['PUT /a', REQUEST_QUERY_BUDGET + 4], ['PUT /b', 2]]);

    expect(staleAllowListEntries({ 'PUT /a': { ticket: 1 }, 'PUT /b': { ticket: 2 } }, seen)).toEqual([
      { route: 'PUT /b', ticket: 2, mostQueries: 2 },
    ]);
  });
});
