import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useAnnouncements } from './use-announcements-api';

describe('useAnnouncements', () => {
  it('returns announcements array', async () => {
    const { result } = renderHook(() => useAnnouncements());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data).toBeInstanceOf(Array);
    expect(data.length).toBeGreaterThan(0);
  });

  it('each announcement has required fields', async () => {
    const { result } = renderHook(() => useAnnouncements());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const announcement = result.current.data![0];
    expect(announcement).toHaveProperty('id');
    expect(announcement).toHaveProperty('title');
    expect(announcement).toHaveProperty('body');
    expect(announcement).toHaveProperty('type');
    expect(announcement).toHaveProperty('severity');
    expect(announcement).toHaveProperty('target');
    expect(announcement).toHaveProperty('status');
    expect(announcement).toHaveProperty('startsAt');
    expect(announcement).toHaveProperty('dismissable');
  });

  it('contains announcements with different statuses', async () => {
    const { result } = renderHook(() => useAnnouncements());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const statuses = new Set(result.current.data!.map((a) => a.status));
    expect(statuses.size).toBeGreaterThan(1);
  });

  it('contains announcements with different severities', async () => {
    const { result } = renderHook(() => useAnnouncements());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const severities = new Set(result.current.data!.map((a) => a.severity));
    expect(severities.size).toBeGreaterThan(1);
  });
});
