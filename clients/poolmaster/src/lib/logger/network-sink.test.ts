import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientLogBatch } from '@poolmaster/shared/dto';
import { server } from '@/test/msw-api';
import { createNetworkSink } from './network-sink';
import type { LogMeta, LogPayload } from './types';

function buildMeta(overrides: Partial<LogMeta> = {}): LogMeta {
  return {
    ts: '2026-04-22T16:00:00.000Z',
    clientTraceId: '11111111-1111-4111-8111-111111111111',
    webappVersion: '1.2.3',
    userAgent: 'vitest',
    route: '/my-leagues',
    ...overrides,
  };
}

function buildPayload(overrides: Partial<LogPayload> = {}): LogPayload {
  return {
    action: 'league.view.loaded',
    ...overrides,
  };
}

describe('network sink', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rule: network log sink flushes when the batch size threshold is reached', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true, retryable: false });
    const sink = createNetworkSink({
      batchSize: 2,
      flushIntervalMs: 10_000,
      transport,
    });

    sink.write('info', buildPayload(), 'first', buildMeta());
    sink.write('warn', buildPayload({ action: 'league.view.empty' }), 'second', buildMeta());

    await vi.waitFor(() => {
      expect(transport).toHaveBeenCalledTimes(1);
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        useBeacon: false,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        body: expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.arrayContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
          entries: expect.arrayContaining([
            expect.objectContaining({ action: 'league.view.loaded' }),
            expect.objectContaining({ action: 'league.view.empty' }),
          ]),
        }),
      }),
    );
  });

  it('rule: network log sink flushes on the timer when the buffer is below the batch threshold', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true, retryable: false });
    const sink = createNetworkSink({
      batchSize: 5,
      flushIntervalMs: 10_000,
      transport,
    });

    sink.write('info', buildPayload(), 'timer flush', buildMeta());

    await vi.advanceTimersByTimeAsync(10_000);

    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rule: network log sink retries once for retryable error-level flush failures', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce({ ok: false, retryable: true })
      .mockResolvedValueOnce({ ok: true, retryable: false });
    const sink = createNetworkSink({
      batchSize: 20,
      flushIntervalMs: 10_000,
      transport,
    });

    sink.write('error', buildPayload({ action: 'contest.create.failed' }), 'boom', buildMeta());

    await vi.waitFor(() => {
      expect(transport).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await vi.waitFor(() => {
      expect(transport).toHaveBeenCalledTimes(2);
    });
  });

  it('rule: network log sink uses beacon flush when the page becomes hidden', async () => {
    const visibilityHandlers: Array<(event: Event) => void> = [];
    const transport = vi.fn().mockResolvedValue({ ok: true, retryable: false });
    const documentLike = {
      visibilityState: 'visible' as Document['visibilityState'],
      addEventListener: vi.fn((event: string, handler: (event: Event) => void) => {
        if (event === 'visibilitychange') {
          visibilityHandlers.push(handler);
        }
      }),
      removeEventListener: vi.fn(),
    };
    const sink = createNetworkSink({
      batchSize: 20,
      flushIntervalMs: 10_000,
      transport,
      documentLike,
    });

    sink.write('info', buildPayload(), 'hidden flush', buildMeta());

    documentLike.visibilityState = 'hidden';
    visibilityHandlers[0]?.(new Event('visibilitychange'));

    await vi.waitFor(() => {
      expect(transport).toHaveBeenCalledWith(
        expect.objectContaining({
          useBeacon: true,
        }),
      );
    });
  });

  it('drops the oldest entries once the buffer is over its limit, sending only the newest', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true, retryable: false });
    const sink = createNetworkSink({ batchSize: 10, maxBufferSize: 2, flushIntervalMs: 10_000, transport });

    sink.write('info', buildPayload({ action: 'first' }), undefined, buildMeta());
    sink.write('info', buildPayload({ action: 'second' }), undefined, buildMeta());
    sink.write('info', buildPayload({ action: 'third' }), undefined, buildMeta());
    await vi.advanceTimersByTimeAsync(10_000);

    expect(transport).toHaveBeenCalledTimes(1);
    const [{ body }] = transport.mock.calls[0] as [{ body: ClientLogBatch }];
    expect(body.entries.map((entry) => entry.action)).toEqual(['second', 'third']);
  });

  it('sends what is left over right away when a full batch is still waiting after a flush', async () => {
    let releaseFirst: (value: { ok: boolean; retryable: boolean }) => void = () => undefined;
    const transport = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValue({ ok: true, retryable: false });
    const sink = createNetworkSink({ batchSize: 2, flushIntervalMs: 10_000, transport });

    sink.write('info', buildPayload({ action: 'a' }), undefined, buildMeta());
    sink.write('info', buildPayload({ action: 'b' }), undefined, buildMeta());
    sink.write('info', buildPayload({ action: 'c' }), undefined, buildMeta());
    sink.write('info', buildPayload({ action: 'd' }), undefined, buildMeta());
    expect(transport).toHaveBeenCalledTimes(1);
    releaseFirst({ ok: true, retryable: false });

    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    const [{ body }] = transport.mock.calls[1] as [{ body: ClientLogBatch }];
    expect(body.entries.map((entry) => entry.action)).toEqual(['c', 'd']);
  });

  it('waits for the timer to send a partial batch written while a flush was in flight', async () => {
    let releaseFirst: (value: { ok: boolean; retryable: boolean }) => void = () => undefined;
    const transport = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValue({ ok: true, retryable: false });
    const sink = createNetworkSink({ batchSize: 5, flushIntervalMs: 10_000, transport });

    sink.write('error', buildPayload({ action: 'failed' }), undefined, buildMeta());
    sink.write('info', buildPayload({ action: 'later' }), undefined, buildMeta());
    releaseFirst({ ok: true, retryable: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(transport).toHaveBeenCalledTimes(2);
    const [{ body }] = transport.mock.calls[1] as [{ body: ClientLogBatch }];
    expect(body.entries.map((entry) => entry.action)).toEqual(['later']);
  });

  it('reports a failed upload once and does not retry when the failure is not retryable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const transport = vi.fn().mockResolvedValue({ ok: false, retryable: false });
    const sink = createNetworkSink({ batchSize: 20, flushIntervalMs: 10_000, transport });

    sink.write('fatal', buildPayload({ action: 'app.crashed' }), 'crash', buildMeta());

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith('PoolMaster client log transport failed'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('gives up after one retry when the upload keeps failing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const transport = vi.fn().mockResolvedValue({ ok: false, retryable: true });
    const sink = createNetworkSink({ batchSize: 20, flushIntervalMs: 10_000, transport });

    sink.write('error', buildPayload(), undefined, buildMeta());
    await vi.advanceTimersByTimeAsync(5_000);

    expect(transport).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the page is hidden with an empty buffer, or becomes visible', async () => {
    const visibilityHandlers: Array<(event: Event) => void> = [];
    const transport = vi.fn().mockResolvedValue({ ok: true, retryable: false });
    const documentLike = {
      visibilityState: 'hidden' as Document['visibilityState'],
      addEventListener: vi.fn((_event: string, handler: (event: Event) => void) => {
        visibilityHandlers.push(handler);
      }),
      removeEventListener: vi.fn(),
    };
    const sink = createNetworkSink({ batchSize: 20, flushIntervalMs: 10_000, transport, documentLike });

    visibilityHandlers[0]?.(new Event('visibilitychange'));
    sink.write('info', buildPayload(), undefined, buildMeta());
    documentLike.visibilityState = 'visible';
    visibilityHandlers[0]?.(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(transport).not.toHaveBeenCalled();
  });

  it('copies each entry\'s optional fields into the batch only when they are present', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true, retryable: false });
    const sink = createNetworkSink({ batchSize: 2, flushIntervalMs: 10_000, transport });

    sink.write(
      'warn',
      buildPayload({ action: 'with.fields', data: { leagueId: 'league-1' }, err: { message: 'boom' } }),
      'with message',
      buildMeta(),
    );
    sink.write('info', buildPayload({ action: 'bare' }), undefined, buildMeta({ route: undefined }));

    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    const [{ body }] = transport.mock.calls[0] as [{ body: ClientLogBatch }];
    expect(body.entries[0]).toEqual({
      level: 'warn',
      action: 'with.fields',
      msg: 'with message',
      ts: '2026-04-22T16:00:00.000Z',
      route: '/my-leagues',
      clientRequestId: null,
      data: { leagueId: 'league-1' },
      err: { message: 'boom' },
    });
    expect(body.entries[1]).toEqual({
      level: 'info',
      action: 'bare',
      ts: '2026-04-22T16:00:00.000Z',
      clientRequestId: null,
    });
  });
});

describe('network sink default transport', () => {
  const endpoint = 'http://localhost/api/v1/client-logs/';
  const immediately = ((callback: () => void) => {
    callback();
    return 0;
  }) as unknown as typeof setTimeout;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the batch as JSON with the trace id of the entries it reports and a fresh request id', async () => {
    const requests: Request[] = [];
    server.use(http.post(endpoint, ({ request }) => {
      requests.push(request.clone());
      return new HttpResponse(null, { status: 204 });
    }));
    const sink = createNetworkSink({ endpoint, batchSize: 1, navigatorLike: { userAgent: 'vitest', sendBeacon: undefined as unknown as Navigator['sendBeacon'] } });

    sink.write('info', buildPayload(), 'sent', buildMeta());

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const [request] = requests;
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(request.headers.get('x-client-trace-id')).toBe('11111111-1111-4111-8111-111111111111');
    expect(request.headers.get('x-client-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const body = await request.json() as ClientLogBatch;
    expect(body).toMatchObject({ schemaVersion: 1, webappVersion: '1.2.3', userAgent: 'vitest' });
    expect(body.entries).toHaveLength(1);
  });

  it('retries once after a server error and stops after a client error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const statuses = [500, 400];
    let calls = 0;
    server.use(http.post(endpoint, () => {
      const status = statuses[calls] ?? 204;
      calls += 1;
      return new HttpResponse(null, { status });
    }));
    const sink = createNetworkSink({ endpoint, batchSize: 1, setTimeoutFn: immediately });

    sink.write('error', buildPayload(), undefined, buildMeta());

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith('PoolMaster client log transport failed'));
    expect(calls).toBe(2);
  });

  it('retries once when the network request itself fails', async () => {
    let calls = 0;
    server.use(http.post(endpoint, () => {
      calls += 1;
      return calls === 1 ? HttpResponse.error() : new HttpResponse(null, { status: 204 });
    }));
    const sink = createNetworkSink({ endpoint, batchSize: 1, setTimeoutFn: immediately });

    sink.write('error', buildPayload(), undefined, buildMeta());

    await vi.waitFor(() => expect(calls).toBe(2));
  });

  it('hands the batch to sendBeacon as JSON when the page is hidden, without a fetch', async () => {
    let fetched = false;
    server.use(http.post(endpoint, () => {
      fetched = true;
      return new HttpResponse(null, { status: 204 });
    }));
    const sendBeacon = vi.fn().mockReturnValue(true);
    const visibilityHandlers: Array<(event: Event) => void> = [];
    const documentLike = {
      visibilityState: 'hidden' as Document['visibilityState'],
      addEventListener: vi.fn((_event: string, handler: (event: Event) => void) => {
        visibilityHandlers.push(handler);
      }),
      removeEventListener: vi.fn(),
    };
    const sink = createNetworkSink({
      endpoint,
      batchSize: 20,
      documentLike,
      navigatorLike: { sendBeacon, userAgent: 'vitest' },
    });

    sink.write('info', buildPayload(), undefined, buildMeta());
    visibilityHandlers[0]?.(new Event('visibilitychange'));

    await vi.waitFor(() => expect(sendBeacon).toHaveBeenCalledTimes(1));
    const [url, blob] = sendBeacon.mock.calls[0] as [string, Blob];
    expect(url).toBe(endpoint);
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await blob.text())).toMatchObject({ schemaVersion: 1 });
    expect(fetched).toBe(false);
  });
});
