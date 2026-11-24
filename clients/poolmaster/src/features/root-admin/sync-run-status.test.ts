import { describe, expect, it } from 'vitest';
import type { ProviderSyncRunDetails } from './root-admin-sync-utils';
import {
  buildRunEvidenceRows,
  formatEventValue,
  getStatusTone,
} from './sync-run-status';

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
