import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { api } from '@/lib/api-client';
import { useNotificationPreferences, useSaveNotificationPreferences } from './use-notification-preferences';
import type { NotificationPreferences } from './use-notification-preferences';

const mockPreferences: NotificationPreferences = {
  categories: {
    draft: { inApp: true, push: true, email: false },
    scoring: { inApp: true, push: true, email: true },
    contest: { inApp: true, push: false, email: true },
    league: { inApp: true, push: false, email: false },
    social: { inApp: true, push: false, email: false },
    account: { inApp: true, push: false, email: true },
  },
  dnd: {
    enabled: false,
    startTime: '22:00',
    endTime: '07:00',
    timezone: 'America/New_York',
  },
};

describe('useNotificationPreferences', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns preferences from API on success', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce(mockPreferences);
    const { result } = renderHook(() => useNotificationPreferences());

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveProperty('categories');
    expect(result.current.data).toHaveProperty('dnd');
  });

  it('calls correct API endpoint', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce(mockPreferences);
    renderHook(() => useNotificationPreferences());

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith('/v1/notifications/preferences');
  });

  it('propagates error when API fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('Network'));
    const { result } = renderHook(() => useNotificationPreferences());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('returns categories with channel toggles', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce(mockPreferences);
    const { result } = renderHook(() => useNotificationPreferences());

    await waitFor(() => expect(result.current.data).toBeDefined());
    const draft = result.current.data!.categories.draft;
    expect(draft).toHaveProperty('inApp');
    expect(draft).toHaveProperty('push');
    expect(draft).toHaveProperty('email');
  });
});

describe('useSaveNotificationPreferences', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends PUT to correct endpoint', async () => {
    const spy = vi.spyOn(api, 'put').mockResolvedValueOnce(undefined);
    // Pre-populate the query cache so optimistic update works
    vi.spyOn(api, 'get').mockResolvedValueOnce(mockPreferences);
    const { result } = renderHook(() => {
      const prefs = useNotificationPreferences();
      const save = useSaveNotificationPreferences();
      return { prefs, save };
    });

    await waitFor(() => expect(result.current.prefs.data).toBeDefined());

    const updated = { ...mockPreferences, dnd: { ...mockPreferences.dnd, enabled: true } };
    result.current.save.mutate(updated);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith('/v1/notifications/preferences', updated);
  });

  it('completes mutation successfully on API response', async () => {
    vi.spyOn(api, 'put').mockResolvedValueOnce(undefined);
    vi.spyOn(api, 'get').mockResolvedValueOnce(mockPreferences);
    const { result } = renderHook(() => {
      const prefs = useNotificationPreferences();
      const save = useSaveNotificationPreferences();
      return { prefs, save };
    });

    await waitFor(() => expect(result.current.prefs.data).toBeDefined());
    result.current.save.mutate(mockPreferences);
    await waitFor(() => expect(result.current.save.isSuccess).toBe(true));
  });

  it('propagates mutation error when API fails', async () => {
    vi.spyOn(api, 'put').mockRejectedValueOnce(new Error('Server error'));
    vi.spyOn(api, 'get').mockResolvedValueOnce(mockPreferences);
    const { result } = renderHook(() => {
      const prefs = useNotificationPreferences();
      const save = useSaveNotificationPreferences();
      return { prefs, save };
    });

    await waitFor(() => expect(result.current.prefs.data).toBeDefined());
    result.current.save.mutate(mockPreferences);
    await waitFor(() => expect(result.current.save.isError).toBe(true));
  });
});
