import { describe, expect, it } from 'vitest';
import {
  deriveGolfAutoTransition,
  deriveGolfTournamentReadiness,
  formatSportEventStatus,
  golfSyncScopeLabel,
  golfSyncScopeTone,
  sportEventStatusTone,
  isAdminManagedGolfTournament,
  localDateTimeInputToIso,
  parseGolfRosterUpload,
  resolveGolfLifecycleStage,
  resolveGolfProviderId,
  type AdminGolfTournamentRound,
} from './golf-admin-utils';

// plans/124 §6.3/§6.4 — pure helpers backing the golf admin keystone screens (pool-master-3dg).

function round(
  roundNumber: number,
  scheduledDate: string,
  scheduledEndAt = '',
): AdminGolfTournamentRound {
  return { roundNumber, scheduledDate, scheduledEndAt };
}

describe('pool-master-3dg golf-admin-utils: sync scope', () => {
  it('pool-master-3dg maps every sync scope to a label and tone', () => {
    expect(golfSyncScopeLabel('NONE')).toBe('Manual');
    expect(golfSyncScopeLabel('SCORES_ONLY')).toBe('Scores synced');
    expect(golfSyncScopeLabel('FULL')).toBe('Fully synced');

    expect(golfSyncScopeTone('NONE')).toBe('active');
    expect(golfSyncScopeTone('SCORES_ONLY')).toBe('info');
    expect(golfSyncScopeTone('FULL')).toBe('neutral');
  });

  it('pool-master-3dg treats only FULL as not admin-managed (§3.5)', () => {
    expect(isAdminManagedGolfTournament('NONE')).toBe(true);
    expect(isAdminManagedGolfTournament('SCORES_ONLY')).toBe(true);
    expect(isAdminManagedGolfTournament('FULL')).toBe(false);
  });
});

describe('pool-master-3dg golf-admin-utils: status formatting', () => {
  it('pool-master-3dg title-cases SCREAMING_SNAKE statuses per word', () => {
    expect(formatSportEventStatus('IN_PROGRESS')).toBe('In Progress');
    expect(formatSportEventStatus('SCHEDULED')).toBe('Scheduled');
  });

  it('pool-master-3dg tones live, completed, and warning statuses distinctly', () => {
    expect(sportEventStatusTone('IN_PROGRESS')).toBe('live');
    expect(sportEventStatusTone('COMPLETED')).toBe('completed');
    expect(sportEventStatusTone('CANCELLED')).toBe('warning');
    expect(sportEventStatusTone('POSTPONED')).toBe('warning');
    expect(sportEventStatusTone('SCHEDULED')).toBe('neutral');
  });
});

describe('pool-master-3dg golf-admin-utils: resolveGolfLifecycleStage', () => {
  const releaseAt = '2026-03-01T00:00:00.000Z';

  it('pool-master-3dg returns null for CANCELLED/POSTPONED (off the rail)', () => {
    expect(
      resolveGolfLifecycleStage({
        status: 'CANCELLED',
        fieldLocked: false,
        releaseAt,
      }),
    ).toBeNull();
    expect(
      resolveGolfLifecycleStage({
        status: 'POSTPONED',
        fieldLocked: true,
        releaseAt,
      }),
    ).toBeNull();
  });

  it('pool-master-3dg maps COMPLETED and IN_PROGRESS to their late stages', () => {
    expect(
      resolveGolfLifecycleStage({ status: 'COMPLETED', fieldLocked: true, releaseAt })
        ?.key,
    ).toBe('COMPLETED');
    expect(
      resolveGolfLifecycleStage({
        status: 'IN_PROGRESS',
        fieldLocked: true,
        releaseAt,
      })?.index,
    ).toBe(3);
  });

  it('pool-master-3dg maps SCHEDULED to Field locked / Field open / Setup by state', () => {
    expect(
      resolveGolfLifecycleStage({ status: 'SCHEDULED', fieldLocked: true, releaseAt })
        ?.key,
    ).toBe('FIELD_LOCKED');
    expect(
      resolveGolfLifecycleStage({
        status: 'SCHEDULED',
        fieldLocked: false,
        releaseAt,
        now: new Date('2026-03-05T00:00:00.000Z'),
      })?.key,
    ).toBe('FIELD_OPEN');
    expect(
      resolveGolfLifecycleStage({
        status: 'SCHEDULED',
        fieldLocked: false,
        releaseAt,
        now: new Date('2026-02-01T00:00:00.000Z'),
      })?.key,
    ).toBe('SETUP');
  });
});

describe('pool-master-3dg golf-admin-utils: deriveGolfAutoTransition', () => {
  const base = {
    autoLifecycleEnabled: true,
    syncScope: 'NONE' as const,
    startDate: '2026-03-12T13:00:00.000Z',
    endDate: '2026-03-15T22:00:00.000Z',
    rounds: [
      round(1, '2026-03-12T13:00:00.000Z', '2026-03-12T23:00:00.000Z'),
      round(2, '2026-03-13T13:00:00.000Z', '2026-03-13T23:00:00.000Z'),
    ],
  };

  it('pool-master-3dg returns null when auto-lifecycle is off or the event is FULL', () => {
    expect(
      deriveGolfAutoTransition({ ...base, status: 'SCHEDULED', autoLifecycleEnabled: false }),
    ).toBeNull();
    expect(
      deriveGolfAutoTransition({ ...base, status: 'SCHEDULED', syncScope: 'FULL' }),
    ).toBeNull();
    expect(
      deriveGolfAutoTransition({ ...base, status: 'COMPLETED' }),
    ).toBeNull();
  });

  it('pool-master-3dg targets IN_PROGRESS from round 1 when SCHEDULED', () => {
    expect(deriveGolfAutoTransition({ ...base, status: 'SCHEDULED' })).toEqual({
      toStatus: 'IN_PROGRESS',
      at: '2026-03-12T13:00:00.000Z',
    });
  });

  it('pool-master-3dg falls back to startDate when no rounds are populated', () => {
    expect(
      deriveGolfAutoTransition({ ...base, status: 'SCHEDULED', rounds: [] }),
    ).toEqual({ toStatus: 'IN_PROGRESS', at: '2026-03-12T13:00:00.000Z' });
  });

  it('pool-master-3dg targets COMPLETED from the last round end, then endDate', () => {
    expect(deriveGolfAutoTransition({ ...base, status: 'IN_PROGRESS' })).toEqual({
      toStatus: 'COMPLETED',
      at: '2026-03-13T23:00:00.000Z',
    });
    expect(
      deriveGolfAutoTransition({
        ...base,
        status: 'IN_PROGRESS',
        rounds: [round(1, '2026-03-12T13:00:00.000Z')],
      }),
    ).toEqual({ toStatus: 'COMPLETED', at: '2026-03-15T22:00:00.000Z' });
  });
});

describe('pool-master-3dg golf-admin-utils: deriveGolfTournamentReadiness', () => {
  const base = { status: 'SCHEDULED' as const, fieldLocked: false, fieldCount: 120, tierCount: 6 };

  it('pool-master-3dg reports Setup with a reason when the field is empty', () => {
    expect(deriveGolfTournamentReadiness({ ...base, fieldCount: 0 })).toEqual({
      label: 'Setup',
      tone: 'neutral',
      reasons: ['No field loaded'],
    });
  });

  it('pool-master-3dg reports Field pending when tiers are undefined', () => {
    expect(deriveGolfTournamentReadiness({ ...base, tierCount: 0 }).label).toBe(
      'Field pending',
    );
  });

  it('pool-master-3dg reports Field locked, Field open, Live, and Completed', () => {
    expect(deriveGolfTournamentReadiness({ ...base, fieldLocked: true }).label).toBe(
      'Field locked',
    );
    expect(deriveGolfTournamentReadiness(base).label).toBe('Field open');
    expect(
      deriveGolfTournamentReadiness({ ...base, status: 'IN_PROGRESS' }).label,
    ).toBe('Live');
    expect(
      deriveGolfTournamentReadiness({ ...base, status: 'COMPLETED' }).label,
    ).toBe('Completed');
  });
});

describe('pool-master-3dg golf-admin-utils: localDateTimeInputToIso', () => {
  it('pool-master-3dg returns undefined for a blank or missing value', () => {
    expect(localDateTimeInputToIso('')).toBeUndefined();
    expect(localDateTimeInputToIso(undefined)).toBeUndefined();
    expect(localDateTimeInputToIso(null)).toBeUndefined();
  });

  it('pool-master-3dg returns undefined for an unparseable value', () => {
    expect(localDateTimeInputToIso('not-a-date')).toBeUndefined();
  });

  it('pool-master-3dg converts a datetime-local value to an ISO string', () => {
    const iso = localDateTimeInputToIso('2026-03-12T13:00');
    expect(iso).toMatch(/^2026-03-12T\d{2}:00:00\.000Z$/);
    expect(new Date(iso ?? '').getMinutes()).toBe(0);
  });
});

describe('pool-master-3dg golf-admin-utils: resolveGolfProviderId', () => {
  it('pool-master-3dg returns the first provider covering GOLF, else null', () => {
    expect(
      resolveGolfProviderId([
        { providerId: 'espn', sportsCovered: ['NFL'] },
        { providerId: 'mock-contest-feed', sportsCovered: ['GOLF', 'NBA'] },
      ]),
    ).toBe('mock-contest-feed');
    expect(resolveGolfProviderId([])).toBeNull();
    expect(resolveGolfProviderId(undefined)).toBeNull();
  });
});

// plans/124 §6.3 Tour Home / §6.4 — league-roster bulk-upload parser.
describe('pool-master-qqs golf-admin-utils: parseGolfRosterUpload', () => {
  it('pool-master-qqs parses CSV rows, coercing worldRanking to a number', () => {
    const rows = parseGolfRosterUpload(
      'externalId,playerName,worldRanking\ndj-1,Dustin Johnson,12\n,Rory McIlroy,3',
      'CSV',
    );
    expect(rows).toEqual([
      { externalId: 'dj-1', playerName: 'Dustin Johnson', worldRanking: 12 },
      { playerName: 'Rory McIlroy', worldRanking: 3 },
    ]);
  });

  it('pool-master-qqs parses a JSON array with participantId passthrough', () => {
    const rows = parseGolfRosterUpload(
      '[{"participantId":"p-1","worldRanking":1}]',
      'JSON',
    );
    expect(rows).toEqual([{ participantId: 'p-1', worldRanking: 1 }]);
  });

  it('pool-master-qqs rejects a row with no identifier', () => {
    expect(() =>
      parseGolfRosterUpload('externalId,playerName,worldRanking\n,,5', 'CSV'),
    ).toThrow(/Row 1: each row needs a participantId, externalId, or playerName/);
  });

  it('pool-master-qqs rejects a non-positive or non-integer worldRanking', () => {
    expect(() =>
      parseGolfRosterUpload('playerName,worldRanking\nRory McIlroy,-2', 'CSV'),
    ).toThrow(/Row 1:/);
    expect(() =>
      parseGolfRosterUpload('playerName,worldRanking\nRory McIlroy,3.5', 'CSV'),
    ).toThrow(/Row 1:/);
  });

  it('pool-master-qqs surfaces the format-level empty-input error', () => {
    expect(() => parseGolfRosterUpload('', 'CSV')).toThrow('Paste or upload some rows first.');
  });
});
