import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityJobDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { ActivityGrid } from './activity-grid';
import { RootAdminActivityPage } from './root-admin-activity-page';
import { activityCountLine, activityWindow, useActivity, type ActivityScope } from './use-activity';

// The one Activity grid (#1879, #1887): the root admin Activity page shows it unscoped, a sport
// league's and an event's tabs scoped. Its codes read as words mapped here, never enum names.

const mocks = vi.hoisted(() => ({
  listActivity: vi.fn(),
  getProviderSyncRun: vi.fn(),
  listProviders: vi.fn(),
}));

bindApiMocks(mocks);

const LEAGUE_ID = '00000000-0000-4000-8000-000000000010';
const EVENT_ID = '00000000-0000-4000-8000-000000000020';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000aa';
const RUN_ID = '00000000-0000-4000-8000-0000000000bb';
const DAY_MS = 24 * 60 * 60_000;

function job(overrides: Partial<ActivityJobDto> = {}): ActivityJobDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'SYNC_LEAGUE_EVENTS',
    kind: 'SYNC',
    status: 'SUCCEEDED',
    sportLeagueId: LEAGUE_ID,
    sportEventId: null,
    sportLeague: { id: LEAGUE_ID, name: 'PGA Tour' },
    sportEvent: null,
    attempts: 1,
    runAt: new Date(Date.now() - 60_000).toISOString(),
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    completedAt: new Date(Date.now() - 50_000).toISOString(),
    lastError: null,
    trigger: 'SCHEDULE',
    startedBy: null,
    startedAt: new Date(Date.now() - 58_000).toISOString(),
    durationSeconds: 8,
    changedCount: 59,
    errorType: null,
    result: null,
    syncRunIds: [],
    ...overrides,
  };
}

const ADMIN_SYNC = job({
  id: '00000000-0000-4000-8000-000000000002',
  trigger: 'ADMIN',
  startedBy: { id: ADMIN_ID, displayName: 'Dana Lee' },
  syncRunIds: [RUN_ID],
});
const FAILED_SCORES = job({
  id: '00000000-0000-4000-8000-000000000003',
  type: 'PROVIDER_EVENT_SYNC',
  status: 'FAILED',
  sportLeagueId: null,
  sportEventId: EVENT_ID,
  sportEvent: { id: EVENT_ID, name: 'The Sentry 2027' },
  trigger: 'WEBHOOK',
  attempts: 3,
  changedCount: null,
  errorType: 'RATE_LIMITED',
  lastError: '429 Too Many Requests from BALLDONTLIE',
  durationSeconds: 31,
});
const COMMISSIONER_EMAIL = job({
  id: '00000000-0000-4000-8000-000000000004',
  type: 'CONTEST_SETTLED_EMAILS',
  kind: 'EMAIL',
  status: 'RUNNING',
  sportLeagueId: null,
  sportLeague: null,
  trigger: 'COMMISSIONER',
  startedBy: { id: '00000000-0000-4000-8000-0000000000cc', displayName: 'Casey Commish' },
  completedAt: null,
  durationSeconds: null,
  changedCount: null,
});

function renderWithClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/activity']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function ScopedGrid({ scope }: { scope: ActivityScope }) {
  return <ActivityGrid activity={useActivity(scope)} />;
}

function seed(jobs: ActivityJobDto[] = [ADMIN_SYNC, FAILED_SCORES, COMMISSIONER_EMAIL]) {
  mocks.listActivity.mockResolvedValue({ data: { jobs } });
  mocks.listProviders.mockResolvedValue({ data: { providers: [] } });
}

function headers() {
  return within(screen.getByTestId('activity-grid-table')).getAllByRole('columnheader').map((header) => header.textContent.trim());
}

/** The query the grid's first read asked for. */
function firstQuery() {
  const [options] = mocks.listActivity.mock.calls[0] as [{ query: Record<string, string> }];
  return options.query;
}

describe('Activity grid', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the shared Activity grid on the Activity page with no scope, reading every job of the past day, with the Sport league and Event columns', async () => {
    seed();
    const before = Date.now();
    renderWithClient(<RootAdminActivityPage />);

    const page = await screen.findByTestId('root-admin-activity-page');
    expect(within(page).getByTestId('activity-grid')).toBeInTheDocument();
    await screen.findByTestId(`activity-job-${ADMIN_SYNC.id}`);
    const query = firstQuery();
    expect(query).not.toHaveProperty('sportLeagueId');
    expect(query).not.toHaveProperty('sportEventId');
    expect(Date.parse(query['from'])).toBeGreaterThanOrEqual(before - DAY_MS - 1000);
    expect(Date.parse(query['from'])).toBeLessThanOrEqual(Date.now() - DAY_MS + 1000);
    expect(headers()).toEqual(expect.arrayContaining(['Sport league', 'Event']));
    expect(screen.getByTestId('activity-grid-filter-summary')).toHaveTextContent('Started');
  });

  it('counts the jobs read, the failed and the running ones, in the page header', async () => {
    seed();
    renderWithClient(<RootAdminActivityPage />);

    expect(await screen.findByTestId('root-admin-activity-counts')).toHaveTextContent('3 jobs · 1 failed · 1 running');
  });

  it('reads one sport league\'s jobs on its tab, leaving out the Sport league column but keeping Event', async () => {
    seed();
    renderWithClient(<ScopedGrid scope={{ sportLeagueId: LEAGUE_ID }} />);

    await screen.findByTestId(`activity-job-${ADMIN_SYNC.id}`);
    expect(firstQuery()).toMatchObject({ sportLeagueId: LEAGUE_ID });
    expect(headers()).not.toContain('Sport league');
    expect(headers()).toContain('Event');
  });

  it('reads one event\'s jobs on its tab, leaving out both the Sport league and Event columns', async () => {
    seed([FAILED_SCORES]);
    renderWithClient(<ScopedGrid scope={{ sportEventId: EVENT_ID }} />);

    await screen.findByTestId(`activity-job-${FAILED_SCORES.id}`);
    expect(firstQuery()).toMatchObject({ sportEventId: EVENT_ID });
    expect(headers()).not.toContain('Sport league');
    expect(headers()).not.toContain('Event');
  });

  it('writes each row\'s codes as their words: kind, what, who started it, status and error', async () => {
    seed();
    renderWithClient(<RootAdminActivityPage />);

    const admin = within(await screen.findByTestId(`activity-job-${ADMIN_SYNC.id}`));
    expect(admin.getByText('Sync')).toBeInTheDocument();
    expect(admin.getByText('Event list')).toBeInTheDocument();
    expect(admin.getByText('Admin')).toBeInTheDocument();
    expect(admin.getByText('Done')).toBeInTheDocument();
    expect(admin.getByText('PGA Tour')).toBeInTheDocument();
    const failed = within(screen.getByTestId(`activity-job-${FAILED_SCORES.id}`));
    expect(failed.getByText('Live scores')).toBeInTheDocument();
    expect(failed.getByText('Webhook')).toBeInTheDocument();
    expect(failed.getByText('Failed')).toBeInTheDocument();
    expect(failed.getByText('Rate limited')).toBeInTheDocument();
    expect(failed.getByText('The Sentry 2027')).toBeInTheDocument();
    const email = within(screen.getByTestId(`activity-job-${COMMISSIONER_EMAIL.id}`));
    expect(email.getByText('Email')).toBeInTheDocument();
    expect(email.getByText('Results')).toBeInTheDocument();
    expect(email.getByText('Commissioner')).toBeInTheDocument();
    expect(email.getByText('Running')).toBeInTheDocument();
  });

  it('names the admin who started a job when Admin is hovered, and System has no one to name', async () => {
    seed([ADMIN_SYNC, job({ id: '00000000-0000-4000-8000-000000000005', trigger: 'SYSTEM' })]);
    renderWithClient(<RootAdminActivityPage />);

    await userEvent.hover(await screen.findByTestId(`activity-started-by-${ADMIN_SYNC.id}`));
    expect(await screen.findByText('Dana Lee')).toBeInTheDocument();
    const system = within(screen.getByTestId('activity-job-00000000-0000-4000-8000-000000000005'));
    expect(system.getByText('System')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-started-by-00000000-0000-4000-8000-000000000005')).not.toBeInTheDocument();
  });

  it('filters Started by from a list of every trigger in its own order, Admin and Commissioner apart, keeping only the ticked ones', async () => {
    seed();
    renderWithClient(<RootAdminActivityPage />);
    await screen.findByTestId(`activity-job-${ADMIN_SYNC.id}`);

    await userEvent.click(screen.getByTestId('activity-grid-filter-startedBy'));
    const popup = within(await screen.findByTestId('activity-grid-filter-startedBy-popup'));
    const boxes = popup.getAllByTestId(/^activity-grid-filter-startedBy-option-/);
    expect(boxes).toHaveLength(5);
    ['Schedule', 'Webhook', 'Admin', 'Commissioner', 'System'].forEach((name, index) => expect(boxes[index]).toHaveAccessibleName(name));
    await userEvent.click(popup.getByTestId('activity-grid-filter-startedBy-all'));
    await userEvent.click(popup.getByTestId('activity-grid-filter-startedBy-option-ADMIN'));
    await userEvent.click(popup.getByTestId('activity-grid-filter-startedBy-option-COMMISSIONER'));
    await userEvent.click(popup.getByTestId('activity-grid-filter-startedBy-apply'));

    await waitFor(() => expect(screen.queryByTestId(`activity-job-${FAILED_SCORES.id}`)).not.toBeInTheDocument());
    expect(screen.getByTestId(`activity-job-${ADMIN_SYNC.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`activity-job-${COMMISSIONER_EMAIL.id}`)).toBeInTheDocument();
  });

  it('opens a failed job\'s dialog from its row with its facts, error and message, view only', async () => {
    seed();
    renderWithClient(<RootAdminActivityPage />);

    await userEvent.click(await screen.findByTestId(`activity-job-${FAILED_SCORES.id}`));
    const dialog = within(await screen.findByTestId('activity-job-dialog'));
    expect(dialog.getByText('Live scores · Failed')).toBeInTheDocument();
    expect(dialog.getByText('Sync · Live scores')).toBeInTheDocument();
    expect(dialog.getByText('PGA Tour · The Sentry 2027')).toBeInTheDocument();
    expect(dialog.getByText('Webhook')).toBeInTheDocument();
    expect(dialog.getByText('Rate limited')).toBeInTheDocument();
    expect(dialog.getByText('429 Too Many Requests from BALLDONTLIE')).toBeInTheDocument();
    expect(dialog.getByText('3')).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('names the admin in a job\'s dialog, and opens the sync run it ran in the dialog\'s place', async () => {
    seed();
    mocks.getProviderSyncRun.mockReturnValue(new Promise(() => {}));
    renderWithClient(<RootAdminActivityPage />);

    await userEvent.click(await screen.findByTestId(`activity-job-${ADMIN_SYNC.id}`));
    const dialog = within(await screen.findByTestId('activity-job-dialog'));
    expect(dialog.getByText('Admin (Dana Lee)')).toBeInTheDocument();
    expect(dialog.getByText('59')).toBeInTheDocument();
    await userEvent.click(dialog.getByTestId(`activity-job-dialog-sync-run-${RUN_ID}`));

    expect(await screen.findByTestId('root-admin-sync-run-by-id')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-job-dialog')).not.toBeInTheDocument();
    expect(mocks.getProviderSyncRun).toHaveBeenCalledWith({ path: { syncRunId: RUN_ID } });
  });

  it('says what went wrong, with a way to try again, when Activity cannot be read', async () => {
    mocks.listActivity.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'Down for a moment.' } } });
    renderWithClient(<RootAdminActivityPage />);

    expect(await screen.findByTestId('activity-grid-error')).toBeInTheDocument();
  });

  it('reads Activity again and shows its jobs when Try again is pressed after a failed read', async () => {
    seed();
    mocks.listActivity.mockResolvedValueOnce({ error: { error: { code: 'INTERNAL', message: 'Down for a moment.' } } });
    renderWithClient(<RootAdminActivityPage />);

    const error = within(await screen.findByTestId('activity-grid-error'));
    await userEvent.click(error.getByRole('button'));

    expect(await screen.findByTestId(`activity-job-${ADMIN_SYNC.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('activity-grid-error')).not.toBeInTheDocument();
  });

  it('closes a job\'s dialog when its Close button is pressed', async () => {
    seed();
    renderWithClient(<RootAdminActivityPage />);

    await userEvent.click(await screen.findByTestId(`activity-job-${FAILED_SCORES.id}`));
    const dialog = within(await screen.findByTestId('activity-job-dialog'));
    await userEvent.click(dialog.getAllByRole('button', { name: 'Close' })[0]);

    await waitFor(() => expect(screen.queryByTestId('activity-job-dialog')).not.toBeInTheDocument());
  });

  it('closes a sync run opened from a job\'s dialog when its Close button is pressed', async () => {
    seed();
    mocks.getProviderSyncRun.mockReturnValue(new Promise(() => {}));
    renderWithClient(<RootAdminActivityPage />);

    await userEvent.click(await screen.findByTestId(`activity-job-${ADMIN_SYNC.id}`));
    await userEvent.click(await screen.findByTestId(`activity-job-dialog-sync-run-${RUN_ID}`));
    const runDialog = await screen.findByTestId('root-admin-sync-run-by-id');
    await userEvent.click(within(runDialog).getAllByRole('button', { name: 'Close' })[0]);

    await waitFor(() => expect(screen.queryByTestId('root-admin-sync-run-by-id')).not.toBeInTheDocument());
  });
});

describe('activityWindow', () => {
  const NOW = Date.parse('2026-11-19T12:00:00.000Z');

  it('reads every job kept, the past 30 days, when the Started filter is cleared', () => {
    expect(activityWindow([], NOW)).toEqual({ from: '2026-10-20T12:00:00.000Z', to: null });
  });

  it('reads from the Started filter\'s first instant, and to its last when it has one', () => {
    const span = { kind: 'calendar', period: 'yesterday' } as const;
    const from = Date.parse('2026-11-18T00:00:00.000Z');
    const to = Date.parse('2026-11-18T23:59:59.999Z');

    expect(activityWindow([{ id: 'started', value: { kind: 'date', span, from, to, timeZone: 'UTC', match: 'overlaps' } }], NOW))
      .toEqual({ from: '2026-11-18T00:00:00.000Z', to: '2026-11-18T23:59:59.999Z' });
    expect(activityWindow([{ id: 'started', value: { kind: 'date', span, from: null, to, timeZone: 'UTC', match: 'overlaps' } }], NOW).from)
      .toBe('2026-10-20T12:00:00.000Z');
  });

  it('leaves a Past span\'s end open, so a job queued after the filter was applied is still read', () => {
    const span = { kind: 'relative', toward: 'past', amount: 1, unit: 'd' } as const;

    expect(activityWindow([{ id: 'started', value: { kind: 'date', span, from: NOW - 24 * 60 * 60_000, to: NOW, timeZone: 'UTC', match: 'overlaps' } }], NOW))
      .toEqual({ from: '2026-11-18T12:00:00.000Z', to: null });
  });
});

describe('activityCountLine', () => {
  it('says how many jobs, leaving out failed and running when there are none', () => {
    expect(activityCountLine([job()])).toBe('1 job');
    expect(activityCountLine([])).toBe('0 jobs');
  });
});
