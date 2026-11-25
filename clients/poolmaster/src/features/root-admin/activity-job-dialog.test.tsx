import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityJobDto } from '@/lib/api';
import { ActivityJobDialog } from './activity-job-dialog';

const RUN_1 = '00000000-0000-4000-8000-0000000000b1';
const RUN_2 = '00000000-0000-4000-8000-0000000000b2';

function job(overrides: Partial<ActivityJobDto> = {}): ActivityJobDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'SYNC_LEAGUE_EVENTS',
    kind: 'SYNC',
    status: 'QUEUED',
    sportLeagueId: null,
    sportEventId: null,
    sportLeague: null,
    sportEvent: null,
    attempts: 0,
    runAt: '2026-11-25T12:00:00.000Z',
    createdAt: '2026-11-25T12:00:00.000Z',
    completedAt: null,
    lastError: null,
    trigger: 'SCHEDULE',
    startedBy: null,
    startedAt: null,
    durationSeconds: null,
    changedCount: null,
    errorType: null,
    result: null,
    syncRunIds: [],
    ...overrides,
  };
}

describe('ActivityJobDialog', () => {
  it('shows a dash for each fact a queued job has not got yet: scope, start, finish and changes', () => {
    render(<ActivityJobDialog job={job()} onClose={vi.fn()} onOpenSyncRun={vi.fn()} />);

    // Sport league · Event, Started, Finished and Changed.
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByTestId('activity-job-dialog-sync-runs')).not.toBeInTheDocument();
  });

  it('says a finished job changed nothing, and leaves out a duration it has not got', () => {
    render(<ActivityJobDialog job={job({ status: 'SUCCEEDED', completedAt: '2026-11-25T12:01:00.000Z', changedCount: 0 })} onClose={vi.fn()} onOpenSyncRun={vi.fn()} />);

    expect(screen.getByText('Nothing')).toBeInTheDocument();
    expect(screen.queryByText(/ · \d+ s$/)).not.toBeInTheDocument();
  });

  it('numbers the sync runs of a job that ran several, and opens the one pressed', async () => {
    const onOpenSyncRun = vi.fn();
    render(<ActivityJobDialog job={job({ syncRunIds: [RUN_1, RUN_2] })} onClose={vi.fn()} onOpenSyncRun={onOpenSyncRun} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open sync run 2' }));

    expect(screen.getByRole('button', { name: 'Open sync run 1' })).toBeInTheDocument();
    expect(onOpenSyncRun).toHaveBeenCalledWith(RUN_2);
  });
});
