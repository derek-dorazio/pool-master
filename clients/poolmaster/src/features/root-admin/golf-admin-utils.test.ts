import { describe, expect, it } from 'vitest';
import type { ParticipantRoundStatus } from '@poolmaster/shared/domain';
import {
  deriveGolfAutoTransition,
  deriveGolfTournamentReadiness,
  describeGolfReleaseBlockers,
  formatSportEventStatus,
  golfSyncScopeLabel,
  golfSyncScopeTone,
  sportEventStatusTone,
  golfParticipantFieldActionLabel,
  localDateTimeInputToIso,
  parseGolfRosterUpload,
  parseGolfRoundScoreUpload,
  resolveGolfLifecycleStage,
  golfRoundScoreRows,
  resolveGolfProviderId,
} from './golf-admin-utils';
import { fieldEntryFixture, participantFixture } from './golf-test-fixtures';
import type { SportEventRoundDto } from '@/lib/api';

// plans/124 §6.3/§6.4 — pure helpers backing the golf admin keystone screens (pool-master-3dg).

function round(
  roundNumber: number,
  scheduledDate: string,
  scheduledEndAt = '',
): SportEventRoundDto {
  return { id: `round-${roundNumber}`, sportEventId: 'event-1', roundNumber, scheduledDate, scheduledEndAt };
}

describe('pool-master-3dg golf-admin-utils: sync scope', () => {
  it('pool-master-3dg maps every sync scope to a label and tone', () => {
    expect(golfSyncScopeLabel('NONE')).toBe('Manual');
    expect(golfSyncScopeLabel('SCORES_ONLY')).toBe('Scores synced');

    expect(golfSyncScopeTone('NONE')).toBe('active');
    expect(golfSyncScopeTone('SCORES_ONLY')).toBe('info');
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

describe('golf-admin-utils: resolveGolfLifecycleStage', () => {
  it('puts CANCELLED and POSTPONED off the rail (null)', () => {
    expect(resolveGolfLifecycleStage('CANCELLED')).toBeNull();
    expect(resolveGolfLifecycleStage('POSTPONED')).toBeNull();
  });

  it('places DRAFT, SCHEDULED, IN_PROGRESS and COMPLETED on Draft, Released, Live and Completed in order', () => {
    expect(resolveGolfLifecycleStage('DRAFT')).toEqual({ key: 'DRAFT', label: 'Draft', index: 0 });
    expect(resolveGolfLifecycleStage('SCHEDULED')?.key).toBe('RELEASED');
    expect(resolveGolfLifecycleStage('IN_PROGRESS')?.index).toBe(2);
    expect(resolveGolfLifecycleStage('COMPLETED')?.key).toBe('COMPLETED');
  });
});

describe('golf-admin-utils: describeGolfReleaseBlockers', () => {
  const now = new Date('2026-04-01T00:00:00.000Z');
  const ready = {
    status: 'DRAFT' as const,
    startDate: '2026-05-07T12:00:00.000Z',
    loadedParticipantCount: 120,
    untieredParticipantCount: 0,
  };

  it('lists nothing for a draft with a loaded, fully tiered field before its start', () => {
    expect(describeGolfReleaseBlockers(ready, now)).toEqual([]);
  });

  it('lists nothing once the tournament is released, whatever its field', () => {
    expect(describeGolfReleaseBlockers({ ...ready, status: 'SCHEDULED', loadedParticipantCount: 0 }, now)).toEqual([]);
  });

  it('asks for the field to be loaded when the draft has none', () => {
    expect(describeGolfReleaseBlockers({ ...ready, loadedParticipantCount: 0 }, now)).toEqual(['Load the field.']);
  });

  it('counts the active golfers still without a tier', () => {
    expect(describeGolfReleaseBlockers({ ...ready, untieredParticipantCount: 1 }, now)).toEqual([
      'Put the 1 active golfer without a tier into a tier.',
    ]);
    expect(describeGolfReleaseBlockers({ ...ready, untieredParticipantCount: 3 }, now)).toEqual([
      'Put the 3 active golfers without a tier into tiers.',
    ]);
  });

  it('says a draft whose start time has passed can no longer be released', () => {
    expect(describeGolfReleaseBlockers({ ...ready, startDate: '2026-03-01T00:00:00.000Z' }, now)).toEqual([
      'Its start time has passed, so it can no longer be released.',
    ]);
  });
});

describe('pool-master-3dg golf-admin-utils: deriveGolfAutoTransition', () => {
  const base = {
    autoLifecycleEnabled: true,
    startDate: '2026-03-12T13:00:00.000Z',
    endDate: '2026-03-15T22:00:00.000Z',
    rounds: [
      round(1, '2026-03-12T13:00:00.000Z', '2026-03-12T23:00:00.000Z'),
      round(2, '2026-03-13T13:00:00.000Z', '2026-03-13T23:00:00.000Z'),
    ],
  };

  it('pool-master-3dg returns null when auto-lifecycle is off or the status is terminal', () => {
    expect(
      deriveGolfAutoTransition({ ...base, status: 'SCHEDULED', autoLifecycleEnabled: false }),
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

describe('golf-admin-utils: deriveGolfTournamentReadiness', () => {
  const base = { status: 'DRAFT' as const, loadedParticipantCount: 120, tierCount: 6, untieredParticipantCount: 0 };

  it('reports Setup with a reason when a draft has no field', () => {
    expect(deriveGolfTournamentReadiness({ ...base, loadedParticipantCount: 0 })).toEqual({
      label: 'Setup',
      tone: 'neutral',
      reasons: ['No field loaded'],
    });
  });

  it('reports Field pending when a draft has no tiers defined', () => {
    expect(deriveGolfTournamentReadiness({ ...base, tierCount: 0 }).label).toBe('Field pending');
  });

  it('reports Tiers pending, with the count, while golfers in a draft have no tier', () => {
    expect(deriveGolfTournamentReadiness({ ...base, untieredParticipantCount: 4 })).toEqual({
      label: 'Tiers pending',
      tone: 'warning',
      reasons: ['4 golfer(s) without a tier'],
    });
  });

  it('reports Ready to release for a fully tiered draft, and Released, Live and Completed after', () => {
    expect(deriveGolfTournamentReadiness(base).label).toBe('Ready to release');
    expect(deriveGolfTournamentReadiness({ ...base, status: 'SCHEDULED' }).label).toBe('Released');
    expect(deriveGolfTournamentReadiness({ ...base, status: 'IN_PROGRESS' }).label).toBe('Live');
    expect(deriveGolfTournamentReadiness({ ...base, status: 'COMPLETED' }).label).toBe('Completed');
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

// plans/124 §6.3 / §4.4a — Field editor Load/Refresh label derivation.
describe('pool-master-za4 golf-admin-utils: golfParticipantFieldActionLabel', () => {
  it('pool-master-za4 says "Load" for an empty field and "Refresh" once it has entries', () => {
    expect(golfParticipantFieldActionLabel(0)).toBe('Load Participant Field');
    expect(golfParticipantFieldActionLabel(1)).toBe('Refresh Participant Field');
    expect(golfParticipantFieldActionLabel(156)).toBe('Refresh Participant Field');
  });
});

// plans/124 §6.3 Tour Home / §6.4 — league-roster bulk-upload parser.
describe('pool-master-qqs golf-admin-utils: parseGolfRosterUpload', () => {
  it('pool-master-qqs parses CSV rows, coercing ranking to a number', () => {
    const rows = parseGolfRosterUpload(
      'externalId,playerName,ranking\ndj-1,Dustin Johnson,12\n,Rory McIlroy,3',
      'CSV',
    );
    expect(rows).toEqual([
      { externalId: 'dj-1', playerName: 'Dustin Johnson', ranking: 12 },
      { playerName: 'Rory McIlroy', ranking: 3 },
    ]);
  });

  it('pool-master-qqs parses a JSON array with participantId passthrough', () => {
    const rows = parseGolfRosterUpload(
      '[{"participantId":"p-1","ranking":1}]',
      'JSON',
    );
    expect(rows).toEqual([{ participantId: 'p-1', ranking: 1 }]);
  });

  it('pool-master-qqs rejects a row with no identifier', () => {
    expect(() =>
      parseGolfRosterUpload('externalId,playerName,ranking\n,,5', 'CSV'),
    ).toThrow(/Row 1: each row needs a participantId, externalId, or playerName/);
  });

  it('pool-master-qqs rejects a non-positive or non-integer ranking', () => {
    expect(() =>
      parseGolfRosterUpload('playerName,ranking\nRory McIlroy,-2', 'CSV'),
    ).toThrow(/Row 1:/);
    expect(() =>
      parseGolfRosterUpload('playerName,ranking\nRory McIlroy,3.5', 'CSV'),
    ).toThrow(/Row 1:/);
  });

  it('pool-master-qqs surfaces the format-level empty-input error', () => {
    expect(() => parseGolfRosterUpload('', 'CSV')).toThrow('Paste or upload some rows first.');
  });
});

// plans/124 §6.3 Round scores / §6.4 — round-score bulk-upload parser.
describe('pool-master-r11 golf-admin-utils: parseGolfRoundScoreUpload', () => {
  it('pool-master-r11 parses CSV rows and upper-cases the status enum', () => {
    const rows = parseGolfRoundScoreUpload(
      'externalId,playerName,strokes,scoreToPar,thru,status\next-1,Rory McIlroy,70,-2,18,completed\n,Scottie Scheffler,68,-4,18,COMPLETED',
      'CSV',
    );
    expect(rows).toEqual([
      { externalId: 'ext-1', playerName: 'Rory McIlroy', strokes: 70, scoreToPar: -2, thru: 18, status: 'COMPLETED' },
      { playerName: 'Scottie Scheffler', strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED' },
    ]);
  });

  it('pool-master-r11 parses a JSON array with participantId and omitted thru', () => {
    expect(
      parseGolfRoundScoreUpload(
        '[{"participantId":"p-1","strokes":71,"scoreToPar":-1,"status":"IN_PROGRESS"}]',
        'JSON',
      ),
    ).toEqual([
      { participantId: 'p-1', strokes: 71, scoreToPar: -1, status: 'IN_PROGRESS' },
    ]);
  });

  it('pool-master-r11 rejects an unknown status', () => {
    expect(() =>
      parseGolfRoundScoreUpload(
        'playerName,strokes,scoreToPar,status\nRory McIlroy,70,-2,FINISHED',
        'CSV',
      ),
    ).toThrow(/Row 1 \(status\)/);
  });

  it('pool-master-r11 rejects a row with no identifier and a non-integer strokes', () => {
    expect(() =>
      parseGolfRoundScoreUpload(
        'externalId,playerName,strokes,scoreToPar,status\n,,70.5,-2,COMPLETED',
        'CSV',
      ),
    ).toThrow(/Row 1/);
  });

  it('pool-master-r11 rejects a thru outside 0-18', () => {
    expect(() =>
      parseGolfRoundScoreUpload(
        'playerName,strokes,scoreToPar,thru,status\nRory McIlroy,70,-2,25,COMPLETED',
        'CSV',
      ),
    ).toThrow(/Row 1 \(thru\)/);
  });

  it('rejects a row with 0 strokes, since a stored round has at least one stroke', () => {
    expect(() =>
      parseGolfRoundScoreUpload(
        'playerName,strokes,scoreToPar,thru,status\nRory McIlroy,0,-2,18,COMPLETED',
        'CSV',
      ),
    ).toThrow(/Row 1 \(strokes\)/);
  });

  it('pool-master-r11 skips template rows left with no score, keeping only the scored ones', () => {
    const rows = parseGolfRoundScoreUpload(
      'externalId,playerName,strokes,scoreToPar,thru,status\n,Rory McIlroy,,,,\n,Scottie Scheffler,68,-4,18,COMPLETED\n,Jon Rahm,,,,',
      'CSV',
    );
    expect(rows).toEqual([
      { playerName: 'Scottie Scheffler', strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED' },
    ]);
  });

  it('pool-master-r11 throws when every row is left blank', () => {
    expect(() =>
      parseGolfRoundScoreUpload(
        'externalId,playerName,strokes,scoreToPar,thru,status\n,Rory McIlroy,,,,\n,Jon Rahm,,,,',
        'CSV',
      ),
    ).toThrow('No scores were entered on any row.');
  });
});

describe('golf-admin-utils: golfRoundScoreRows (issue 236)', () => {
  function result(roundNumber: number, strokes: number, status: ParticipantRoundStatus = 'COMPLETED') {
    return {
      id: `r-${roundNumber}`,
      sportEventRoundId: `round-${roundNumber}`,
      roundNumber,
      status,
      completedAt: null,
      golf: { strokes, scoreToPar: strokes - 71, thru: 18 },
    };
  }

  it('takes the golfers with a golf result in the chosen round, sorted by name', () => {
    const field = [
      fieldEntryFixture({
        id: 'sep-z',
        participant: participantFixture({ name: 'Zach' }),
        rounds: [result(1, 70), result(2, 72, 'IN_PROGRESS')],
      }),
      fieldEntryFixture({ id: 'sep-a', participant: participantFixture({ name: 'Adam' }), rounds: [result(2, 69)] }),
      fieldEntryFixture({ id: 'sep-none', participant: participantFixture({ name: 'Nobody' }), rounds: [] }),
    ];

    expect(golfRoundScoreRows(field, 2)).toEqual([
      { sportEventParticipantId: 'sep-a', participantName: 'Adam', strokes: 69, scoreToPar: -2, thru: 18, status: 'COMPLETED', completedAt: null },
      { sportEventParticipantId: 'sep-z', participantName: 'Zach', strokes: 72, scoreToPar: 1, thru: 18, status: 'IN_PROGRESS', completedAt: null },
    ]);
    expect(golfRoundScoreRows(field, 4)).toEqual([]);
  });

  it('skips a round row that carries no golf result', () => {
    const field = [
      fieldEntryFixture({ rounds: [{ ...result(1, 70), golf: null }] }),
    ];
    expect(golfRoundScoreRows(field, 1)).toEqual([]);
  });
});
