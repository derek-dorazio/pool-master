import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNetworkSink } from './network-sink';
import type { LogMeta, LogPayload } from './types';

function buildMeta(overrides: Partial<LogMeta> = {}): LogMeta {
  return {
    ts: '2026-04-22T16:00:00.000Z',
    clientTraceId: '11111111-1111-4111-8111-111111111111',
    webappVersion: '1.2.3',
    userAgent: 'vitest',
    route: '/my-leagues',
    sessionId: null,
    userId: null,
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
        body: expect.objectContaining({
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
});
