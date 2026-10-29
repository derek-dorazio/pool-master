import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './use-debounced-value';

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the last settled value until the new one has held still for the whole delay', () => {
    const { rerender, result } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'ali' },
    });
    expect(result.current).toBe('ali');

    rerender({ value: 'alic' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ value: 'alice' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('ali');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('alice');
  });
});
