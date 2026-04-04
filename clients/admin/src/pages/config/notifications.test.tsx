import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { Component as NotificationConfigPage } from './notifications';

const { mockUpdateNotificationTemplate } = vi.hoisted(() => ({
  mockUpdateNotificationTemplate: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  client: {},
  adminUpdatePushTrigger: vi.fn(),
  adminUpdateNotificationTemplate: mockUpdateNotificationTemplate,
  adminUpdateRateLimitConfig: vi.fn(),
  adminUpdateDigestConfig: vi.fn(),
}));

vi.mock('@/hooks/use-config-api', () => ({
  usePushTriggers: () => ({
    data: [
      { id: 'pt-1', eventType: 'draft.pick_made', title: 'Pick Made', body: 'A pick was made in your draft', priority: 'high' as const, sound: 'default', enabled: true },
      { id: 'pt-2', eventType: 'scoring.update', title: 'Score Update', body: 'Scores have been updated', priority: 'normal' as const, sound: 'default', enabled: true },
    ],
    isLoading: false,
  }),
  useNotificationTemplates: () => ({
    data: [
      { id: 'nt-1', eventType: 'draft.started', pushTitle: 'Draft Started', pushBody: 'Your draft has begun!', emailSubject: 'Draft Started', emailBodyPreview: 'Your draft...', inAppTitle: 'Draft Started', inAppBody: 'Your draft has begun!' },
      { id: 'nt-2', eventType: 'contest.completed', pushTitle: 'Contest Complete', pushBody: 'Final standings are in!', emailSubject: 'Contest Results', emailBodyPreview: 'Final...', inAppTitle: 'Contest Complete', inAppBody: 'Results are in!' },
    ],
    isLoading: false,
  }),
  useChannelDefaults: () => ({
    data: [
      { category: 'Draft', channels: ['push', 'in_app'] as const },
      { category: 'Scoring', channels: ['push', 'email', 'in_app'] as const },
    ],
    isLoading: false,
  }),
  useRateLimits: () => ({
    data: {
      pushPerHour: 10,
      emailPerDay: 20,
      smsPerDay: 5,
      dedupWindowSeconds: 300,
      collapseRules: [
        { eventType: 'scoring.update', maxPerHour: 3, windowMinutes: 15 },
      ],
    },
    isLoading: false,
  }),
  useDigestConfig: () => ({
    data: {
      subjectTemplate: 'Weekly Recap — {{league_name}}',
      headerTemplate: 'Here is your weekly recap!',
      footerTemplate: 'See you next week!',
      includeStandings: true,
      includeHighlights: true,
      includeUpcomingEvents: false,
      lookbackDays: 7,
      sendDay: 'MONDAY' as const,
      sendHourUtc: 9,
      enabled: true,
    },
    isLoading: false,
  }),
  useDigestPreview: () => ({
    data: 'Subject: Weekly Recap\n\nStandings:\n1. Team Alpha - 287.5 pts',
    isLoading: false,
  }),
}));

function renderPage() {
  return render(<NotificationConfigPage />);
}

describe('NotificationConfigPage', () => {
  beforeEach(() => {
    mockUpdateNotificationTemplate.mockReset();
  });

  it('renders the push triggers section with event types', () => {
    renderPage();
    expect(screen.getByText('Push Triggers')).toBeInTheDocument();
    expect(screen.getByText('draft.pick_made')).toBeInTheDocument();
    // scoring.update appears in both push triggers and collapse rules tables
    expect(screen.getAllByText('scoring.update').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the notification templates section', () => {
    renderPage();
    expect(screen.getByText('Notification Templates')).toBeInTheDocument();
    expect(screen.getByText('draft.started')).toBeInTheDocument();
    expect(screen.getByText('contest.completed')).toBeInTheDocument();
  });

  it('renders the channel defaults section', () => {
    renderPage();
    expect(screen.getByText('Channel Defaults')).toBeInTheDocument();
    // Category names may also appear in other sections
    expect(screen.getAllByText('Draft').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Scoring').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the rate limits section with input fields', () => {
    renderPage();
    expect(screen.getByText('Rate Limits')).toBeInTheDocument();
    expect(screen.getByText('Push per hour')).toBeInTheDocument();
    expect(screen.getByText('Email per day')).toBeInTheDocument();
    expect(screen.getByText('SMS per day')).toBeInTheDocument();
  });

  it('sends the notification template email body through the emailText contract field', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('draft.started'));

    const pushTitleInput = screen.getAllByDisplayValue('Draft Started')[0];
    await user.clear(pushTitleInput);
    await user.type(pushTitleInput, 'Draft Started Updated');

    const emailBodyInput = screen.getByDisplayValue('Your draft...');
    await user.clear(emailBodyInput);
    await user.type(emailBodyInput, 'Updated digest body');

    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(mockUpdateNotificationTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { eventType: 'draft.started' },
        body: expect.objectContaining({
          pushTitle: 'Draft Started Updated',
          emailText: 'Updated digest body',
          emailSubject: 'Draft Started',
        }),
      }),
    );
  }, 10000);
});
