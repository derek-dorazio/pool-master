import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import type { ProviderSyncRun } from './root-admin-sync-utils';
import { SyncRunDialog } from './sync-run-dialog';

// A sync run's dialog, opened from an Activity job: its facts, then what it changed and captured.

const { getProviderSyncRunMock } = vi.hoisted(() => ({ getProviderSyncRunMock: vi.fn() }));

bindApiMocks({ getProviderSyncRun: getProviderSyncRunMock });

function syncRun(overrides: Partial<ProviderSyncRun> = {}): ProviderSyncRun {
  return {
    id: 'sync-run-1',
    providerId: '6f1e9a52-0000-4000-8000-000000000001',
    providerName: 'Mock contest feed',
    sport: 'GOLF',
    eventId: 'masters-2026',
    status: 'COMPLETED',
    startedAt: '2026-05-25T12:00:00.000Z',
    completedAt: '2026-05-25T12:01:00.000Z',
    createdAt: '2026-05-25T11:59:00.000Z',
    payload: {},
    ...overrides,
  } as ProviderSyncRun;
}

/** getProviderSyncRun's answer; the dialog reads only the run's details from it. */
function detailResponse(details: Record<string, unknown> | null) {
  return { data: { ...syncRun(), details } };
}

function renderDialog(run: ProviderSyncRun, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SyncRunDialog onClose={onClose} run={run} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const REQUEST_PAYLOAD = {
  sport: 'GOLF',
  eventId: 'masters-2026',
  source: 'MANUAL',
  actor: { type: 'ROOT_ADMIN', userId: 'root-admin-1', email: 'root@example.test' },
  normalizedAt: '2026-04-09T10:00:00.000Z',
};

describe('SyncRunDialog', () => {
  beforeEach(() => {
    getProviderSyncRunMock.mockReset();
  });

  it('loads the run\'s details by its id and names its provider from the run', async () => {
    getProviderSyncRunMock.mockResolvedValue(detailResponse({}));
    renderDialog(syncRun());

    expect(await screen.findByText('Sync run details')).toBeInTheDocument();
    expect(screen.getByText('Mock contest feed')).toBeInTheDocument();
    expect(getProviderSyncRunMock).toHaveBeenCalledTimes(1);
    expect(getProviderSyncRunMock).toHaveBeenCalledWith(expect.objectContaining({ path: { syncRunId: 'sync-run-1' } }));
  });

  it('shows the run\'s warnings and stats, and opens the raw provider payload in place', async () => {
    const user = userEvent.setup();
    getProviderSyncRunMock.mockResolvedValue(detailResponse({
      providerPayload: {
        operation: 'EVENTLIVESCORES',
        rawCaptured: true,
        rawTruncated: false,
        raw: [{ path: '/v1/scenarios/golf/events/masters-2026/scores', raw: { contestants: [] } }],
      },
      jobPayload: { jobType: 'EVENT_LIVE_SCORES_SYNC', status: 'COMPLETED', recordsProcessed: 0 },
    }));
    renderDialog(syncRun({
      payload: {
        runType: 'MANUAL_EVENT_SYNC',
        requestedFeed: 'EVENTLIVESCORES',
        outcome: {
          severity: 'WARNING',
          summary: 'Completed event live scores sync for masters-2026 (0 records).',
          warnings: [{ code: 'NO_PROVIDER_LIVE_SCORES', message: 'Provider returned no live-score updates for the requested event.' }],
          errors: 0,
        },
        stats: { providerRecordsReturned: 0, liveScoreUpdatesReturned: 0 },
        requestPayload: REQUEST_PAYLOAD,
      },
    } as Partial<ProviderSyncRun>));

    expect(await screen.findByText('Provider Records Returned')).toBeInTheDocument();
    expect(screen.getByText('Live Score Updates Returned')).toBeInTheDocument();
    expect(screen.getByText('Provider returned no live-score updates for the requested event.')).toBeInTheDocument();

    await user.click(await screen.findByTestId('root-admin-sync-payload-provider-toggle'));

    expect(screen.getByText(/"rawCaptured": true/)).toBeInTheDocument();
    expect(screen.getByText(/"contestants": \[\]/)).toBeInTheDocument();
  });

  it('says no rows changed and points to the raw provider payload when a sync changed nothing', async () => {
    getProviderSyncRunMock.mockResolvedValue(detailResponse({
      providerPayload: {
        operation: 'EVENTPARTICIPANTS',
        rawCaptured: true,
        rawTruncated: false,
        raw: [{ path: '/vendor/events/future-open-2026/field', raw: { records: [{ id: 'vendor-player-1' }] } }],
      },
    }));
    renderDialog(syncRun({ providerId: 'future-feed' }));

    expect(
      await screen.findByText('No Primetime Commissioner rows changed in this sync. Open the provider payload below to see what the provider sent.'),
    ).toBeInTheDocument();
  });

  it('lists each written row and opens its before-after JSON and the request payload in place', async () => {
    const user = userEvent.setup();
    getProviderSyncRunMock.mockResolvedValue(detailResponse({
      writeDiagnostics: {
        summary: { total: 2, unchanged: 0, created: 1, updated: 1, deleted: 0 },
        rows: [
          {
            id: 'sport-event-participant:mock-contest-feed:masters-2026:golfer-1',
            entityType: 'SportEventParticipant',
            disposition: 'UPDATED',
            providerId: 'mock-contest-feed',
            externalId: 'masters-2026',
            participantExternalId: 'golfer-1',
            internalId: 'event-participant-1',
            name: 'Jordan Example',
            before: { seedNumber: 4, oddsToWin: 18, ranking: 6 },
            after: { seedNumber: 3, oddsToWin: 12, ranking: 3 },
          },
          {
            id: 'sport-event-participant:mock-contest-feed:masters-2026:golfer-2',
            entityType: 'SportEventParticipant',
            disposition: 'CREATED',
            providerId: 'mock-contest-feed',
            externalId: 'masters-2026',
            participantExternalId: 'golfer-2',
            internalId: 'event-participant-2',
            name: 'Casey Example',
            after: { seedNumber: 18, oddsToWin: 24, ranking: 18 },
          },
        ],
      },
    }));
    renderDialog(syncRun({
      payload: { runType: 'MANUAL_EVENT_SYNC', requestedFeed: 'EVENTPARTICIPANTS', requestPayload: REQUEST_PAYLOAD },
    } as Partial<ProviderSyncRun>));

    expect(await screen.findByTestId('root-admin-sync-detail-rows')).toBeInTheDocument();
    expect(screen.getByText('Jordan Example')).toBeInTheDocument();
    expect(screen.getByText('Casey Example')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'JSON for UPDATED SportEventParticipant Jordan Example' }));

    expect(screen.getByText(/"oddsToWin": 18/)).toBeInTheDocument();
    expect(screen.getByText(/"oddsToWin": 12/)).toBeInTheDocument();

    await user.click(screen.getByTestId('root-admin-sync-payload-request-toggle'));

    expect(
      within(screen.getByTestId('root-admin-sync-payload-request-details')).getByText(/"eventId": "masters-2026"/),
    ).toBeInTheDocument();
  });

  it('says a run that has not started has no details yet, and offers no provider or job payload', async () => {
    getProviderSyncRunMock.mockResolvedValue(detailResponse(null));
    renderDialog(syncRun({ status: 'SUBMITTED', startedAt: null, completedAt: null, payload: { requestedFeed: 'EVENTPARTICIPANTS' } }));

    expect(await screen.findByText('This run hasn\'t started yet, so it has no details.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sync-payload-provider')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sync-payload-job')).not.toBeInTheDocument();
  });

  it('says details are kept for 30 days when a finished run has none left', async () => {
    getProviderSyncRunMock.mockResolvedValue(detailResponse(null));
    renderDialog(syncRun());

    expect(await screen.findByText('Detailed diagnostics are kept for 30 days. None are stored for this run.')).toBeInTheDocument();
  });

  it('shows the server\'s reason when a run\'s details cannot be loaded', async () => {
    getProviderSyncRunMock.mockResolvedValue({ error: { error: { code: 'SYNC_RUN_NOT_FOUND', message: 'No sync run sync-run-1' } } });
    renderDialog(syncRun());

    expect(await screen.findByText('Sync run not found.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sync-detail-rows')).not.toBeInTheDocument();
  });

  it('closes when its Close button is pressed', async () => {
    getProviderSyncRunMock.mockResolvedValue(detailResponse({}));
    const onClose = vi.fn();
    renderDialog(syncRun(), onClose);

    await screen.findByText('Sync run details');
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);

    expect(onClose).toHaveBeenCalled();
  });
});
