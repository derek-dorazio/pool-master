import { describe, it, expect } from 'vitest';
import { mapAdminAnnouncementToUiAnnouncement } from './use-announcements-api';

describe('mapAdminAnnouncementToUiAnnouncement', () => {
  it('maps the admin announcement contract into the admin UI view model', () => {
    expect(
      mapAdminAnnouncementToUiAnnouncement({
        id: 'ann-1',
        type: 'BANNER',
        title: 'System Notice',
        body: 'Scheduled maintenance tonight',
        linkUrl: 'https://example.com/status',
        linkText: 'Status page',
        severity: 'CRITICAL',
        target: 'ALL_USERS',
        startsAt: '2026-04-02T18:00:00.000Z',
        endsAt: null,
        dismissable: true,
        isActive: true,
      }),
    ).toEqual({
      id: 'ann-1',
      type: 'Banner',
      title: 'System Notice',
      body: 'Scheduled maintenance tonight',
      linkUrl: 'https://example.com/status',
      linkText: 'Status page',
      severity: 'Critical',
      target: 'ALL_USERS',
      status: 'Active',
      startsAt: '2026-04-02T18:00:00.000Z',
      endsAt: null,
      dismissable: true,
    });
  });
});
