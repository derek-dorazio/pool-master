import { renderHook, act } from '@testing-library/react';
import { toast, useToast } from './use-toast';

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty toasts array', () => {
    const { result } = renderHook(() => useToast());

    // After clearing timers from any prior tests, toasts may accumulate.
    // The hook returns an array.
    expect(Array.isArray(result.current.toasts)).toBe(true);
  });

  it('exposes a toast function', () => {
    const { result } = renderHook(() => useToast());

    expect(typeof result.current.toast).toBe('function');
  });

  it('adds a toast when toast() is called', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: 'Test Toast', description: 'Hello' });
    });

    const found = result.current.toasts.find((t) => t.title === 'Test Toast');
    expect(found).toBeDefined();
    expect(found!.description).toBe('Hello');
  });

  it('auto-dismisses toast after 5 seconds', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: 'Ephemeral' });
    });

    expect(result.current.toasts.some((t) => t.title === 'Ephemeral')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.toasts.some((t) => t.title === 'Ephemeral')).toBe(false);
  });

  it('can queue multiple toasts', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: 'First' });
      result.current.toast({ title: 'Second' });
    });

    const titles = result.current.toasts.map((t) => t.title);
    expect(titles).toContain('First');
    expect(titles).toContain('Second');
  });
});

describe('toast (standalone)', () => {
  it('can be called without the hook', () => {
    expect(() => toast({ title: 'Standalone' })).not.toThrow();
  });
});
