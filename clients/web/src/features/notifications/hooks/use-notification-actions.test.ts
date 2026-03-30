import { renderHook } from '@/test-utils';
import { useMarkAsRead, useMarkAllAsRead } from './use-notification-actions';

describe('useMarkAsRead', () => {
  it('returns a mutation with mutate function', () => {
    const { result } = renderHook(() => useMarkAsRead());

    expect(typeof result.current.mutate).toBe('function');
    expect(typeof result.current.mutateAsync).toBe('function');
  });
});

describe('useMarkAllAsRead', () => {
  it('returns a mutation with mutate function', () => {
    const { result } = renderHook(() => useMarkAllAsRead());

    expect(typeof result.current.mutate).toBe('function');
    expect(typeof result.current.mutateAsync).toBe('function');
  });
});
