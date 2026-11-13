import { describe, expect, it } from 'vitest';
import type { ProviderSyncRun, ProviderSyncRunDetails, ProviderSyncRunPayload } from './root-admin-sync-utils';
import {
  buildRunEvidenceRows,
  formatEventValue,
  getRunStatusLabel,
  getRunStatusTone,
  getStatusTone,
  toSortableTimestamp,
} from './sync-run-status';

function run(status: ProviderSyncRun['status'], payload: ProviderSyncRunPayload = {}): ProviderSyncRun {
  return {
    id: 'sync-run',
    providerId: 'balldontlie',
    sport: 'GOLF',
    eventId: null,
    status,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-05-25T11:59:00.000Z',
    payload,
  };
}

const warning = { code: 'NO_PROVIDER_LIVE_SCORES', message: 'No live-score updates.' };

type Outcome = NonNullable<ProviderSyncRunPayload['outcome']>;

function outcome(severity: Outcome['severity'], warnings: Outcome['warnings'] = []): ProviderSyncRunPayload {
  return { outcome: { severity, summary: 'Synced.', warnings, errors: 0 } };
}

describe('toSortableTimestamp', () => {
  it('turns an ISO time into its epoch milliseconds so runs sort by time', () => {
    expect(toSortableTimestamp('2026-05-25T12:00:00.000Z')).toBe(Date.UTC(2026, 4, 25, 12));
  });

  it.each([null, undefined, '', 'not a date'])('sorts a missing or unreadable time (%j) first, as 0', (value) => {
    expect(toSortableTimestamp(value)).toBe(0);
  });
});

describe('formatEventValue', () => {
  it('shows the event id as given', () => {
    expect(formatEventValue('golf-masters-2026')).toBe('golf-masters-2026');
  });

  it.each([null, undefined, '', '   '])('reads "No event" when the run has no event (%j)', (value) => {
    expect(formatEventValue(value)).toBe('No event');
  });
});

describe('getStatusTone', () => {
  it.each([
    ['COMPLETED', 'success'],
    ['HEALTHY', 'success'],
    ['FAILED', 'danger'],
    ['UNHEALTHY', 'danger'],
    ['IN_PROGRESS', 'warning'],
    ['SUBMITTED', 'warning'],
    ['CANCELLED', 'neutral'],
    ['SOMETHING_NEW', 'neutral'],
  ])('draws status %s in the %s tone', (status, tone) => {
    expect(getStatusTone(status)).toBe(tone);
  });
});

describe('getRunStatusTone', () => {
  it('follows the run status when the outcome is a success with no warning', () => {
    expect(getRunStatusTone(run('COMPLETED'))).toBe('success');
    expect(getRunStatusTone(run('FAILED', outcome('SUCCESS')))).toBe('danger');
  });

  it('turns a completed run amber when its outcome is a warning, even with no warning listed', () => {
    expect(getRunStatusTone(run('COMPLETED', outcome('WARNING')))).toBe('warning');
  });

  it('turns a run amber when its successful outcome still lists a warning', () => {
    expect(getRunStatusTone(run('COMPLETED', outcome('SUCCESS', [warning])))).toBe('warning');
  });

  it('turns a completed run red when its outcome is an error', () => {
    expect(getRunStatusTone(run('COMPLETED', outcome('ERROR')))).toBe('danger');
  });

  it('keeps a failed run red even when its outcome lists a warning', () => {
    expect(getRunStatusTone(run('FAILED', outcome('WARNING', [warning])))).toBe('danger');
  });

  it('shows warnings over an error, so a run with both reads amber', () => {
    expect(getRunStatusTone(run('COMPLETED', outcome('ERROR', [warning])))).toBe('warning');
  });
});

describe('getRunStatusLabel', () => {
  it('reads "COMPLETED WITH WARNINGS" for a completed run whose outcome is a warning', () => {
    expect(getRunStatusLabel(run('COMPLETED', outcome('WARNING'))))
      .toBe('COMPLETED WITH WARNINGS');
  });

  it('reads "COMPLETED WITH WARNINGS" for a completed run whose successful outcome still lists a warning', () => {
    expect(getRunStatusLabel(run('COMPLETED', outcome('SUCCESS', [warning])))).toBe('COMPLETED WITH WARNINGS');
  });

  it('reads the plain status for a clean completed run, and for any run not completed even with warnings', () => {
    expect(getRunStatusLabel(run('COMPLETED'))).toBe('COMPLETED');
    expect(getRunStatusLabel(run('FAILED', outcome('WARNING', [warning])))).toBe('FAILED');
  });
});

describe('buildRunEvidenceRows', () => {
  it.each([null, undefined, {}])('has no rows when the run wrote nothing (%j)', (details) => {
    expect(buildRunEvidenceRows(details as ProviderSyncRunDetails | null | undefined)).toEqual([]);
  });

  it('names each written row by its internal id and keeps its before and after values', () => {
    const details: ProviderSyncRunDetails = {
      writeDiagnostics: {
        summary: { total: 1, unchanged: 0, created: 0, updated: 1, deleted: 0 },
        rows: [{
          id: 'row-1',
          entityType: 'SportEventParticipant',
          disposition: 'UPDATED',
          providerId: 'balldontlie',
          externalId: 'masters-2026',
          participantExternalId: 'golfer-1',
          internalId: 'event-participant-1',
          name: 'Jordan Example',
          before: { ranking: 6 },
          after: { ranking: 3 },
        }],
      },
    };

    expect(buildRunEvidenceRows(details)).toEqual([{
      id: 'row-1',
      disposition: 'UPDATED',
      entityType: 'SportEventParticipant',
      identifier: 'event-participant-1',
      name: 'Jordan Example',
      providerId: 'balldontlie',
      eventId: 'masters-2026',
      participantId: 'golfer-1',
      detailsPayload: {
        disposition: 'UPDATED',
        entityType: 'SportEventParticipant',
        providerId: 'balldontlie',
        externalId: 'masters-2026',
        participantExternalId: 'golfer-1',
        internalId: 'event-participant-1',
        name: 'Jordan Example',
        before: { ranking: 6 },
        after: { ranking: 3 },
      },
    }]);
  });

  it('falls back through external id, participant id and row id, and reads "No …" for missing values', () => {
    const details: ProviderSyncRunDetails = {
      writeDiagnostics: {
        summary: { total: 3, unchanged: 0, created: 3, updated: 0, deleted: 0 },
        rows: [
          { id: 'row-ext', entityType: 'SportEvent', disposition: 'CREATED', externalId: 'masters-2026' },
          { id: 'row-part', entityType: 'Participant', disposition: 'CREATED', participantExternalId: 'golfer-2' },
          { id: 'row-bare', entityType: 'Participant', disposition: 'CREATED' },
        ],
      },
    };

    const rows = buildRunEvidenceRows(details);

    expect(rows.map((row) => row.identifier)).toEqual(['masters-2026', 'golfer-2', 'row-bare']);
    expect(rows[2]).toMatchObject({
      name: 'No name',
      providerId: 'No provider',
      eventId: 'No event',
      participantId: 'No participant',
      detailsPayload: {
        providerId: null,
        externalId: null,
        participantExternalId: null,
        internalId: null,
        name: null,
      },
    });
    expect(rows[2]?.detailsPayload).not.toHaveProperty('before');
    expect(rows[2]?.detailsPayload).not.toHaveProperty('after');
  });
});
