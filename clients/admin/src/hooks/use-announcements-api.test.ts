import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { useAnnouncements } from './use-announcements-api';

const mockAnnouncements = [
  {
    id: 'ann-001',
    title: 'Scheduled Maintenance — March 28',
    body: 'Platform will undergo scheduled maintenance.',
    type: 'Both',
    severity: 'Warning',
    target: 'All Users',
    status: 'Active',
    startsAt: '2026-03-26T00:00:00Z',
    endsAt: '2026-03-28T08:00:00Z',
    dismissable: true,
    linkUrl: '/status',
    linkText: 'View Status Page',
  },
  {
    id: 'ann-002',
    title: 'New Feature: Live Draft Chat',
    body: 'Chat with other participants during live drafts.',
    type: 'Notification',
    severity: 'Info',
    target: 'All Users',
    status: 'Active',
    startsAt: '2026-03-25T00:00:00Z',
    endsAt: '2026-04-01T00:00:00Z',
    dismissable: true,
  },
  {
    id: 'ann-003',
    title: 'ESPN Data Provider Outage',
    body: 'Intermittent issues with ESPN data feeds.',
    type: 'Banner',
    severity: 'Critical',
    target: 'All Users',
    status: 'Expired',
    startsAt: '2026-03-24T10:00:00Z',
    endsAt: '2026-03-24T18:00:00Z',
    dismissable: false,
  },
  {
    id: 'ann-004',
    title: 'Welcome to Ultimate Pool Manager!',
    body: 'Get started by creating your first contest.',
    type: 'Banner',
    severity: 'Info',
    target: 'New Users',
    status: 'Scheduled',
    startsAt: '2026-04-01T00:00:00Z',
    endsAt: null,
    dismissable: true,
    linkUrl: '/onboarding',
    linkText: 'Get Started',
  },
];

describe('useAnnouncements', () => {
  beforeEach(() => {
    // Override default MSW handler to return announcement data as an array
    // (the hook expects Announcement[], not { announcements: [] })
    server.use(
      http.get('/api/v1/admin/announcements', () => {
        return HttpResponse.json(mockAnnouncements);
      }),
    );
  });

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
