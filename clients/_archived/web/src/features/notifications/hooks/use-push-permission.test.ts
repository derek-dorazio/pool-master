import { renderHook, act } from '@testing-library/react';
import { usePushPermission } from './use-push-permission';

describe('usePushPermission', () => {
  const originalNotification = globalThis.Notification;

  function mockNotification(permission: string, requestResult?: string) {
    const mock = {
      permission,
      requestPermission: vi.fn().mockResolvedValue(requestResult ?? permission),
    };
    Object.defineProperty(globalThis, 'Notification', {
      value: mock,
      writable: true,
      configurable: true,
    });
    return mock;
  }

  function removeNotification() {
    delete (globalThis as Record<string, unknown>).Notification;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'Notification', {
      value: originalNotification,
      writable: true,
      configurable: true,
    });
  });

  it('returns unsupported when Notification API is not available', () => {
    removeNotification();

    const { result } = renderHook(() => usePushPermission());

    expect(result.current.permission).toBe('unsupported');
    expect(result.current.isSupported).toBe(false);
    expect(result.current.isGranted).toBe(false);
  });

  it('returns current permission state when Notification is available', () => {
    mockNotification('default');

    const { result } = renderHook(() => usePushPermission());

    expect(result.current.permission).toBe('default');
    expect(result.current.isSupported).toBe(true);
    expect(result.current.isDefault).toBe(true);
    expect(result.current.isGranted).toBe(false);
    expect(result.current.isDenied).toBe(false);
  });

  it('returns granted state correctly', () => {
    mockNotification('granted');

    const { result } = renderHook(() => usePushPermission());

    expect(result.current.permission).toBe('granted');
    expect(result.current.isGranted).toBe(true);
    expect(result.current.isDefault).toBe(false);
  });

  it('returns denied state correctly', () => {
    mockNotification('denied');

    const { result } = renderHook(() => usePushPermission());

    expect(result.current.permission).toBe('denied');
    expect(result.current.isDenied).toBe(true);
    expect(result.current.isGranted).toBe(false);
  });

  it('requestPermission returns unsupported when not available', async () => {
    removeNotification();

    const { result } = renderHook(() => usePushPermission());

    let permResult: string | undefined;
    await act(async () => {
      permResult = await result.current.requestPermission();
    });

    expect(permResult).toBe('unsupported');
  });

  it('requestPermission calls Notification.requestPermission and updates state', async () => {
    const mock = mockNotification('default', 'granted');

    const { result } = renderHook(() => usePushPermission());
    expect(result.current.permission).toBe('default');

    await act(async () => {
      const permResult = await result.current.requestPermission();
      expect(permResult).toBe('granted');
    });

    expect(mock.requestPermission).toHaveBeenCalled();
    expect(result.current.permission).toBe('granted');
    expect(result.current.isGranted).toBe(true);
  });
});
