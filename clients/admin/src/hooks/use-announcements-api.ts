import { useQuery } from '@tanstack/react-query';
import { client, adminListAnnouncements } from '@/lib/api';

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

export function useAnnouncements() {
  return useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {
      const { data } = await adminListAnnouncements({ client });
      return data;
    },
  });
}
