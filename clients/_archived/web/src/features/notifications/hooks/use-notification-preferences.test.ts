import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
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
    server.use(
      http.get('/api/v1/notifications/preferences', () => {
        return HttpResponse.json(mockPreferences);
      }),
    );
    const { result } = renderHook(() => useNotificationPreferences());

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveProperty('categories');
    expect(result.current.data).toHaveProperty('dnd');
  });

  it('fetches from the notifications preferences endpoint', async () => {
    let requestUrl = '';
    server.use(
      http.get('/api/v1/notifications/preferences', ({ request }) => {
        requestUrl = new URL(request.url).pathname;
        return HttpResponse.json(mockPreferences);
      }),
    );
    renderHook(() => useNotificationPreferences());

    await waitFor(() => expect(requestUrl).toBe('/api/v1/notifications/preferences'));
  });

  it('propagates error when API fails', async () => {
    server.use(
      http.get('/api/v1/notifications/preferences', () => {
        return HttpResponse.json({ message: 'Server error' }, { status: 500 });
      }),
    );
    const { result } = renderHook(() => useNotificationPreferences());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('returns categories with channel toggles', async () => {
    server.use(
      http.get('/api/v1/notifications/preferences', () => {
        return HttpResponse.json(mockPreferences);
      }),
    );
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
    let capturedMethod = '';
    let capturedPath = '';
    server.use(
      http.get('/api/v1/notifications/preferences', () => {
        return HttpResponse.json(mockPreferences);
      }),
      http.put('/api/v1/notifications/preferences', ({ request }) => {
        capturedMethod = request.method;
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json({ success: true });
      }),
    );
    const { result } = renderHook(() => {
      const prefs = useNotificationPreferences();
      const save = useSaveNotificationPreferences();
      return { prefs, save };
    });

    await waitFor(() => expect(result.current.prefs.data).toBeDefined());

    const updated = { ...mockPreferences, dnd: { ...mockPreferences.dnd, enabled: true } };
    result.current.save.mutate(updated);
    await waitFor(() => expect(capturedPath).toBe('/api/v1/notifications/preferences'));
    expect(capturedMethod).toBe('PUT');
  });

  it('completes mutation successfully on API response', async () => {
    server.use(
      http.get('/api/v1/notifications/preferences', () => {
        return HttpResponse.json(mockPreferences);
      }),
      http.put('/api/v1/notifications/preferences', () => {
        return HttpResponse.json({ success: true });
      }),
    );
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
    server.use(
      http.get('/api/v1/notifications/preferences', () => {
        return HttpResponse.json(mockPreferences);
      }),
      http.put('/api/v1/notifications/preferences', () => {
        return HttpResponse.json({ message: 'Server error' }, { status: 500 });
      }),
    );
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
