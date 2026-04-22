import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrCreateClientTraceId, resetClientTraceIdForTests } from './client-trace-id';

describe('client trace id', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    resetClientTraceIdForTests();
  });

  it('reuses the session storage trace id when present', () => {
    window.sessionStorage.setItem('poolmaster_client_trace_id', 'trace-123');

    expect(getOrCreateClientTraceId()).toBe('trace-123');
  });

  it('creates and stores a trace id when none exists', () => {
    const traceId = getOrCreateClientTraceId();

    expect(traceId).toBeTruthy();
    expect(window.sessionStorage.getItem('poolmaster_client_trace_id')).toBe(traceId);
  });

  it('falls back to an in-memory id when session storage throws', () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('session storage unavailable');
      });
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('session storage unavailable');
      });

    const first = getOrCreateClientTraceId();
    const second = getOrCreateClientTraceId();

    expect(first).toBe(second);

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it('creates different trace ids after reset', () => {
    const first = getOrCreateClientTraceId();
    resetClientTraceIdForTests();
    window.sessionStorage.clear();

    const second = getOrCreateClientTraceId();

    expect(second).not.toBe(first);
  });
});
