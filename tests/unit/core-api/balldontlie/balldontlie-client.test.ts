import { z } from 'zod';
import { expect } from '@jest/globals';
import {
  BalldontlieClient,
  BalldontlieContractError,
  BalldontlieRequestError,
  type BalldontlieClientOptions,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { ProviderPayloadRecorder } from '../../../../packages/core-api/src/modules/ingestion/adapters/provider-payload-recorder';
import { pgaTournamentListSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/pga-contract';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

const BASE_URL = 'https://api.balldontlie.example';
const rowsSchema = z.object({
  data: z.array(z.object({ id: z.number() })),
  meta: z.object({ next_cursor: z.number().nullable().optional() }).optional(),
});

interface SentRequest {
  url: string;
  headers: Headers;
  at: number;
}

/** A clock that only moves when the client waits, so pacing is read without real time. */
function virtualClock() {
  let now = 1_000_000;
  const waits: number[] = [];
  return {
    now: () => now,
    sleep: (ms: number) => {
      waits.push(ms);
      now += ms;
      return Promise.resolve();
    },
    waits,
  };
}

function setup(
  replies: Array<Response | Error>,
  options: Partial<BalldontlieClientOptions> = {},
) {
  const clock = virtualClock();
  const sent: SentRequest[] = [];
  const queue = [...replies];
  const originalFetch = global.fetch;
  global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    sent.push({ url, headers: new Headers(init?.headers), at: clock.now() });
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request ${url}`);
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as typeof fetch;
  const payloads = new ProviderPayloadRecorder('balldontlie.request');
  const client = new BalldontlieClient({
    baseUrl: `${BASE_URL}/`,
    apiKey: 'test-key',
    requestsPerMinute: 60,
    payloads,
    now: clock.now,
    sleep: clock.sleep,
    ...options,
  });
  return { client, sent, clock, payloads, restore: () => { global.fetch = originalFetch; } };
}

const page = (ids: number[], nextCursor?: number | null) =>
  Response.json({ data: ids.map((id) => ({ id })), meta: nextCursor === undefined ? {} : { next_cursor: nextCursor } });

describe('BalldontlieClient', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it('sends the API key as the bare Authorization header the vendor documents, with no Bearer prefix', async () => {
    const harness = setup([Response.json({ data: [] })]);
    restore = harness.restore;

    await harness.client.get('/pga/v2/tournaments', {}, rowsSchema);

    expect(harness.sent[0].headers.get('authorization')).toBe('test-key');
    expect(harness.sent[0].url).toBe(`${BASE_URL}/pga/v2/tournaments`);
  });

  it('sends an array query value once per item under the key as given, and leaves undefined values out', async () => {
    const harness = setup([Response.json({ data: [] })]);
    restore = harness.restore;

    await harness.client.get('/pga/v1/players', { 'player_ids[]': [185, 75], active: true, season: undefined }, rowsSchema);

    expect(harness.sent[0].url).toBe(`${BASE_URL}/pga/v1/players?player_ids%5B%5D=185&player_ids%5B%5D=75&active=true`);
  });

  it('spaces requests to the plan\'s rate limit: at 60 a minute each starts a second after the last', async () => {
    const harness = setup([Response.json({ data: [] }), Response.json({ data: [] }), Response.json({ data: [] })]);
    restore = harness.restore;

    await harness.client.get('/a', {}, rowsSchema);
    await harness.client.get('/b', {}, rowsSchema);
    await harness.client.get('/c', {}, rowsSchema);

    const starts = harness.sent.map((request) => request.at - harness.sent[0].at);
    expect(starts).toEqual([0, 1_000, 2_000]);
  });

  it('gives requests made together consecutive slots, so the third waits two intervals', async () => {
    const harness = setup([Response.json({ data: [] }), Response.json({ data: [] }), Response.json({ data: [] })]);
    restore = harness.restore;
    const waits: number[] = [];
    const client = new BalldontlieClient({
      baseUrl: BASE_URL,
      apiKey: 'k',
      requestsPerMinute: 60,
      payloads: harness.payloads,
      now: () => 5_000,
      sleep: (ms) => { waits.push(ms); return Promise.resolve(); },
    });

    await Promise.all(['/a', '/b', '/c'].map((path) => client.get(path, {}, rowsSchema)));

    expect(waits).toEqual([1_000, 2_000]);
  });

  it('paces the free plan\'s 5 requests a minute 12 seconds apart', async () => {
    const harness = setup([Response.json({ data: [] }), Response.json({ data: [] })], { requestsPerMinute: 5 });
    restore = harness.restore;

    await harness.client.get('/a', {}, rowsSchema);
    await harness.client.get('/b', {}, rowsSchema);

    expect(harness.sent[1].at - harness.sent[0].at).toBe(12_000);
  });

  it('refuses a rate limit that is not a whole number of at least one', () => {
    const payloads = new ProviderPayloadRecorder('balldontlie.request');
    expect(() => new BalldontlieClient({ baseUrl: BASE_URL, apiKey: 'k', requestsPerMinute: 0, payloads }))
      .toThrow('BALLDONTLIE requestsPerMinute must be a whole number of at least 1, not 0.');
    expect(() => new BalldontlieClient({ baseUrl: BASE_URL, apiKey: 'k', requestsPerMinute: 2.5, payloads }))
      .toThrow('not 2.5');
  });

  it('retries a 429 after the Retry-After seconds it names, then returns the parsed body', async () => {
    const harness = setup([
      new Response('{"error":"Too many requests"}', { status: 429, headers: { 'retry-after': '7' } }),
      Response.json({ data: [{ id: 1 }] }),
    ]);
    restore = harness.restore;

    const result = await harness.client.get('/a', {}, rowsSchema);

    expect(result.data).toEqual([{ id: 1 }]);
    expect(harness.clock.waits).toContain(7_000);
    expect(harness.sent).toHaveLength(2);
  });

  it('retries a 5xx with doubling back-off (1 s, 2 s, 4 s) and fails with the vendor\'s error message once retries run out', async () => {
    const harness = setup([
      new Response('{"error":"boom"}', { status: 503 }),
      new Response('{"error":"boom"}', { status: 503 }),
      new Response('{"error":"boom"}', { status: 503 }),
      new Response('{"error":"still down"}', { status: 503, statusText: 'Service Unavailable' }),
    ], { requestsPerMinute: 600 });
    restore = harness.restore;

    const failure = harness.client.get('/a', {}, rowsSchema);

    await expect(failure).rejects.toThrow(new BalldontlieRequestError('/a', 503, '503 still down'));
    await expect(failure).rejects.toMatchObject({ status: 503, path: '/a' });
    expect(harness.clock.waits.filter((ms) => ms >= 1_000)).toEqual([1_000, 2_000, 4_000]);
    expect(harness.sent).toHaveLength(4);
  });

  it('retries a 429 whose Retry-After is an HTTP date with the ordinary back-off', async () => {
    const harness = setup([
      new Response('', { status: 429, headers: { 'retry-after': 'Wed, 11 Nov 2026 07:28:00 GMT' } }),
      Response.json({ data: [] }),
    ], { requestsPerMinute: 600 });
    restore = harness.restore;

    await harness.client.get('/a', {}, rowsSchema);

    expect(harness.clock.waits.filter((ms) => ms >= 1_000)).toEqual([1_000]);
  });

  it('retries a request that timed out or never connected, and names the attempts when every one fails', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const harness = setup([timeout, timeout], { maxRetries: 1 });
    restore = harness.restore;

    const failure = harness.client.get('/a', {}, rowsSchema);

    await expect(failure).rejects.toThrow('BALLDONTLIE request /a failed: no response after 2 attempts');
    await expect(failure).rejects.toMatchObject({ status: null, cause: timeout });
  });

  it('fails a 401 at once, without retrying, naming the status and the vendor\'s message', async () => {
    const harness = setup([new Response('{"error":"Unauthorized"}', { status: 401 })]);
    restore = harness.restore;

    await expect(harness.client.get('/a', {}, rowsSchema)).rejects.toThrow('BALLDONTLIE request /a failed: 401 Unauthorized');
    expect(harness.sent).toHaveLength(1);
  });

  it('falls back to the status text when an error body is not the vendor\'s JSON error shape', async () => {
    const harness = setup([
      new Response('<html>gateway</html>', { status: 400, statusText: 'Bad Request' }),
      new Response('{"message":"other shape"}', { status: 404, statusText: 'Not Found' }),
    ]);
    restore = harness.restore;

    await expect(harness.client.get('/a', {}, rowsSchema)).rejects.toThrow('400 Bad Request');
    await expect(harness.client.get('/b', {}, rowsSchema)).rejects.toThrow('404 Not Found');
  });

  it('reports a 200 body that is not JSON as a contract error', async () => {
    const harness = setup([new Response('<html>maintenance</html>', { status: 200 })]);
    restore = harness.restore;

    await expect(harness.client.get('/a', {}, rowsSchema)).rejects.toBeInstanceOf(BalldontlieContractError);
  });

  it('reports a body that does not fit the schema as a contract error naming each field that broke', async () => {
    const harness = setup([Response.json({ data: [{ id: 'forty' }] })]);
    restore = harness.restore;

    const failure = harness.client.get('/pga/v2/tournaments?x=1', {}, rowsSchema);

    await expect(failure).rejects.toBeInstanceOf(BalldontlieContractError);
    await expect(failure).rejects.toMatchObject({ issues: ['data.0.id: Invalid input: expected number, received string'] });
  });

  it('names the root when the whole body is the wrong shape', async () => {
    const harness = setup([Response.json([1, 2])]);
    restore = harness.restore;

    await expect(harness.client.get('/a', {}, rowsSchema)).rejects.toMatchObject({
      issues: ['(root): Invalid input: expected object, received array'],
    });
  });

  it('follows the cursor across full pages and stops at a page with no next cursor', async () => {
    const full = Array.from({ length: 100 }, (_, index) => index + 1);
    const harness = setup([page(full, 100), page([101, 102])]);
    restore = harness.restore;

    const rows = await harness.client.getAllPages('/pga/v2/tournaments', { season: 2026 }, rowsSchema);

    expect(rows.map((row) => row.id)).toEqual([...full, 101, 102]);
    expect(harness.sent.map((request) => new URL(request.url).search)).toEqual([
      '?season=2026&per_page=100',
      '?season=2026&per_page=100&cursor=100',
    ]);
  });

  it('stops at a short page even when it carries a next cursor, as the vendor\'s documented example does', async () => {
    const harness = setup([page([1, 2], 2)]);
    restore = harness.restore;

    const rows = await harness.client.getAllPages('/a', {}, rowsSchema);

    expect(rows).toHaveLength(2);
    expect(harness.sent).toHaveLength(1);
  });

  it('stops at a full page whose next cursor is null', async () => {
    const harness = setup([page(Array.from({ length: 100 }, (_, index) => index), null)]);
    restore = harness.restore;

    expect(await harness.client.getAllPages('/a', {}, rowsSchema)).toHaveLength(100);
  });

  it('gives up with a contract error when the cursor never ends', async () => {
    const full = Array.from({ length: 100 }, (_, index) => index);
    const harness = setup(Array.from({ length: 200 }, () => page(full, 1)), { requestsPerMinute: 600 });
    restore = harness.restore;

    await expect(harness.client.getAllPages('/a', {}, rowsSchema)).rejects.toThrow('pagination did not end after 200 pages');
  });

  it('keeps each response body for the sync run\'s diagnostics only inside a capture session', async () => {
    const body = readBalldontlieFixture('pga', 'doc-example-tournaments.json');
    const harness = setup([Response.json(body), Response.json(body)]);
    restore = harness.restore;

    await harness.client.get('/pga/v2/tournaments', {}, pgaTournamentListSchema);
    const session = harness.payloads.beginProviderPayloadCapture();
    await session.run(() => harness.client.get('/pga/v2/tournaments', { season: 2026 }, pgaTournamentListSchema));

    expect(session.consumeProviderPayloads()).toEqual([
      expect.objectContaining({ operation: 'balldontlie.request', path: '/pga/v2/tournaments?season=2026', raw: body }),
    ]);
    expect(harness.payloads.consumeProviderPayloads()).toEqual([]);
  });

  it('uses real time and a ten-second timeout when no clock is injected', async () => {
    const originalFetch = global.fetch;
    let signal: AbortSignal | null | undefined;
    global.fetch = jest.fn((_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      return Promise.resolve(Response.json({ data: [] }));
    }) as typeof fetch;
    restore = () => { global.fetch = originalFetch; };
    const client = new BalldontlieClient({
      baseUrl: BASE_URL,
      apiKey: 'k',
      requestsPerMinute: 6_000,
      payloads: new ProviderPayloadRecorder('balldontlie.request'),
    });

    await client.get('/a', {}, rowsSchema);
    await client.get('/b', {}, rowsSchema);

    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
