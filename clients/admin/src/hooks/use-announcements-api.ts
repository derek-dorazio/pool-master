import { useQuery } from '@tanstack/react-query';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  type: 'Banner' | 'Notification' | 'Both';
  severity: 'Info' | 'Warning' | 'Critical';
  target: string;
  status: 'Active' | 'Scheduled' | 'Expired';
  startsAt: string;
  endsAt: string | null;
  dismissable: boolean;
  linkUrl?: string;
  linkText?: string;
}

const MOCK_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'ann-001',
    title: 'Scheduled Maintenance — March 28',
    body: 'PoolMaster will undergo scheduled maintenance on March 28 from 2:00 AM to 4:00 AM EST. During this time, the platform may be temporarily unavailable.',
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
    body: 'You can now chat with other participants during live drafts! Look for the chat icon in your draft room.',
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
    body: 'We are currently experiencing intermittent issues with ESPN data feeds. Scoring updates may be delayed by up to 15 minutes.',
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
    title: 'Welcome to PoolMaster!',
    body: 'Thanks for joining PoolMaster. Get started by creating your first contest or joining an existing one.',
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

export function useAnnouncements() {
  return useQuery({
    queryKey: ['announcements'],
    queryFn: async (): Promise<Announcement[]> => {
      await new Promise((r) => setTimeout(r, 200));
      return [...MOCK_ANNOUNCEMENTS];
    },
  });
}
