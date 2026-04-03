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

function toAnnouncementType(type: string): Announcement['type'] {
  switch (type) {
    case 'BANNER':
      return 'Banner';
    case 'NOTIFICATION':
      return 'Notification';
    default:
      return 'Both';
  }
}

function toAnnouncementSeverity(severity: string): Announcement['severity'] {
  switch (severity) {
    case 'CRITICAL':
      return 'Critical';
    case 'WARNING':
      return 'Warning';
    default:
      return 'Info';
  }
}

function toAnnouncementStatus(announcement: {
  isActive: boolean;
  startsAt: string;
  endsAt?: string | null;
}): Announcement['status'] {
  if (!announcement.isActive) return 'Expired';

  const now = Date.now();
  const startsAt = new Date(announcement.startsAt).getTime();
  const endsAt = announcement.endsAt ? new Date(announcement.endsAt).getTime() : null;

  if (startsAt > now) return 'Scheduled';
  if (endsAt !== null && endsAt <= now) return 'Expired';
  return 'Active';
}

export function mapAdminAnnouncementToUiAnnouncement(announcement: {
  id: string;
  type: string;
  title: string;
  body: string;
  linkUrl?: string | null;
  linkText?: string | null;
  severity: string;
  target: string;
  startsAt: string;
  endsAt?: string | null;
  dismissable: boolean;
  isActive: boolean;
}): Announcement {
  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    type: toAnnouncementType(announcement.type),
    severity: toAnnouncementSeverity(announcement.severity),
    target: announcement.target,
    status: toAnnouncementStatus(announcement),
    startsAt: announcement.startsAt,
    endsAt: announcement.endsAt ?? null,
    dismissable: announcement.dismissable,
    linkUrl: announcement.linkUrl ?? undefined,
    linkText: announcement.linkText ?? undefined,
  };
}

export function useAnnouncements() {
  return useQuery({
    queryKey: ['announcements'],
    queryFn: async (): Promise<Announcement[]> => {
      const { data } = await adminListAnnouncements({ client });
      const response = (data ?? []) as { items?: Array<{
        id: string;
        type: string;
        title: string;
        body: string;
        linkUrl: string | null;
        linkText: string | null;
        severity: string;
        target: string;
        startsAt: string;
        endsAt: string | null;
        dismissable: boolean;
        isActive: boolean;
      }> } | Array<{
        id: string;
        type: string;
        title: string;
        body: string;
        linkUrl: string | null;
        linkText: string | null;
        severity: string;
        target: string;
        startsAt: string;
        endsAt: string | null;
        dismissable: boolean;
        isActive: boolean;
      }>;
      const items = Array.isArray(response) ? response : response.items ?? [];
      return items.map(mapAdminAnnouncementToUiAnnouncement);
    },
  });
}
