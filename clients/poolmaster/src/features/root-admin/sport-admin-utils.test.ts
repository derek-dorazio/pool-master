import { describe, expect, it } from 'vitest';
import type { ParticipantRoundStatus } from '@poolmaster/shared/domain';
import {
  deriveSportEventReadiness,
  formatSportEventStatus,
  syncScopeLabel,
  syncScopeTone,
  sportEventStatusTone,
  participantFieldActionLabel,
  parseRosterUpload,
  parseGolfRoundScoreUpload,
  golfRoundScoreRows,
  sportProviderOptions,
} from './sport-admin-utils';
import { fieldEntryFixture, participantFixture } from './sport-test-fixtures';

// plans/124 §6.3/§6.4 — pure helpers backing the golf admin keystone screens (pool-master-3dg).

describe('pool-master-3dg sport-admin-utils: sync scope', () => {
  it('pool-master-3dg maps every sync scope to a label and tone', () => {
    expect(syncScopeLabel('NONE')).toBe('Manual');
    expect(syncScopeLabel('SCORES_ONLY')).toBe('Scores synced');

    expect(syncScopeTone('NONE')).toBe('active');
    expect(syncScopeTone('SCORES_ONLY')).toBe('info');
  });
});

describe('pool-master-3dg sport-admin-utils: status formatting', () => {
  it('an event status reads its display string, sentence case like every other status', () => {
    expect(formatSportEventStatus('IN_PROGRESS')).toBe('In progress');
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

const STANDARD_PRICING = { profileName: 'Standard', salaryCap: 50000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };

describe('sport-admin-utils: deriveSportEventReadiness', () => {
  const base = {
    sport: 'GOLF' as const,
    status: 'DRAFT' as const,
    loadedParticipantCount: 120,
    tierCount: 6,
    adminCounts: { untieredParticipantCount: 0, unpricedParticipantCount: 0, emptyTierLabels: [] as string[], contestCount: 0 },
    pricing: STANDARD_PRICING,
  };

  it('reports Setup with a reason when a draft has no field', () => {
    expect(deriveSportEventReadiness({ ...base, loadedParticipantCount: 0 })).toEqual({
      label: 'Setup',
      tone: 'neutral',
      reasons: ['No field loaded'],
    });
  });

  it('reports Field pending when a draft has no tiers defined', () => {
    expect(deriveSportEventReadiness({ ...base, tierCount: 0 }).label).toBe('Field pending');
  });

  it('reports Tiers pending, with the count, while golfers in a draft have no tier', () => {
    expect(deriveSportEventReadiness({ ...base, adminCounts: { ...base.adminCounts, untieredParticipantCount: 4 } })).toEqual({
      label: 'Tiers pending',
      tone: 'warning',
      reasons: ['4 golfers without a tier'],
    });
  });

  it('reports Tiers pending, naming the empty tier, while a draft has a tier no active participant is in', () => {
    expect(deriveSportEventReadiness({ ...base, sport: 'AUTO_RACING', tierCount: 4, adminCounts: { ...base.adminCounts, emptyTierLabels: ['Tier 4'] } })).toEqual({
      label: 'Tiers pending',
      tone: 'warning',
      reasons: ['Tier 4 has no drivers'],
    });
  });

  it('reports Prices pending while a fully tiered draft is unpriced or has golfers without a price (#93)', () => {
    expect(deriveSportEventReadiness({ ...base, pricing: null })).toEqual({
      label: 'Prices pending',
      tone: 'warning',
      reasons: ['No prices assigned'],
    });
    expect(deriveSportEventReadiness({ ...base, adminCounts: { ...base.adminCounts, unpricedParticipantCount: 2 } }).reasons).toEqual(['2 golfers without a price']);
  });

  it('counts a horse race\'s untiered and unpriced runners as horses, one horse singular', () => {
    const race = { ...base, sport: 'HORSE_RACING' as const };
    expect(deriveSportEventReadiness({ ...race, adminCounts: { ...race.adminCounts, untieredParticipantCount: 1 } }).reasons).toEqual(['1 horse without a tier']);
    expect(deriveSportEventReadiness({ ...race, adminCounts: { ...race.adminCounts, unpricedParticipantCount: 3 } }).reasons).toEqual(['3 horses without a price']);
  });

  it('reports Checking readiness, not Ready to release, for a priced draft whose admin counts are missing', () => {
    expect(deriveSportEventReadiness({ ...base, adminCounts: null })).toEqual({ label: 'Checking readiness', tone: 'neutral', reasons: [] });
  });

  it('reports Ready to release for a fully tiered and priced draft, and Released, Live and Completed after', () => {
    expect(deriveSportEventReadiness(base).label).toBe('Ready to release');
    expect(deriveSportEventReadiness({ ...base, status: 'SCHEDULED' }).label).toBe('Released');
    expect(deriveSportEventReadiness({ ...base, status: 'IN_PROGRESS' }).label).toBe('Live');
    expect(deriveSportEventReadiness({ ...base, status: 'COMPLETED' }).label).toBe('Completed');
  });
});

describe('sport-admin-utils: provider resolution', () => {
  const providers = [
    { providerId: 'balldontlie', providerName: 'BALLDONTLIE', sportsCovered: ['GOLF'], primaryForSports: [] },
    { providerId: 'espn', providerName: 'ESPN', sportsCovered: ['NFL'], primaryForSports: ['NFL'] },
    { providerId: 'mock-contest-feed', providerName: 'Mock feed', sportsCovered: ['GOLF', 'NBA'], primaryForSports: ['GOLF', 'NBA'] },
  ];

  it('lists the providers covering a sport with its primary first, whatever order the list holds them in', () => {
    expect(sportProviderOptions(providers, 'GOLF')).toEqual([
      { providerId: 'mock-contest-feed', providerName: 'Mock feed' },
      { providerId: 'balldontlie', providerName: 'BALLDONTLIE' },
    ]);
    expect(sportProviderOptions(providers, 'HORSE_RACING')).toEqual([]);
    expect(sportProviderOptions(undefined, 'GOLF')).toEqual([]);
  });

  it('puts the first provider covering a sport first when none is its primary', () => {
    expect(sportProviderOptions([providers[0]], 'GOLF').at(0)?.providerId).toBe('balldontlie');
    expect(sportProviderOptions([], 'GOLF')).toEqual([]);
  });
});

// plans/124 §6.3 / §4.4a — Field editor Load/Refresh label derivation.
describe('pool-master-za4 sport-admin-utils: participantFieldActionLabel', () => {
  it('pool-master-za4 says "Load" for an empty field and "Refresh" once it has entries', () => {
    expect(participantFieldActionLabel(0)).toBe('Load Participant Field');
    expect(participantFieldActionLabel(1)).toBe('Refresh Participant Field');
    expect(participantFieldActionLabel(156)).toBe('Refresh Participant Field');
  });
});

// plans/124 §6.3 Tour Home / §6.4 — league-roster bulk-upload parser.
describe('pool-master-qqs sport-admin-utils: parseRosterUpload', () => {
  it('pool-master-qqs parses CSV rows, coercing ranking to a number', () => {
    const rows = parseRosterUpload(
      'externalId,playerName,ranking\ndj-1,Dustin Johnson,12\n,Rory McIlroy,3',
      'CSV',
    );
    expect(rows).toEqual([
      { externalId: 'dj-1', playerName: 'Dustin Johnson', ranking: 12 },
      { playerName: 'Rory McIlroy', ranking: 3 },
    ]);
  });

  it('pool-master-qqs parses a JSON array with participantId passthrough', () => {
    const rows = parseRosterUpload(
      '[{"participantId":"p-1","ranking":1}]',
      'JSON',
    );
    expect(rows).toEqual([{ participantId: 'p-1', ranking: 1 }]);
  });

  it('pool-master-qqs rejects a row with no identifier', () => {
    expect(() =>
      parseRosterUpload('externalId,playerName,ranking\n,,5', 'CSV'),
    ).toThrow(/Row 1: each row needs a participantId, externalId, or playerName/);
  });

  it('pool-master-qqs rejects a non-positive or non-integer ranking', () => {
    expect(() =>
      parseRosterUpload('playerName,ranking\nRory McIlroy,-2', 'CSV'),
    ).toThrow(/Row 1:/);
    expect(() =>
      parseRosterUpload('playerName,ranking\nRory McIlroy,3.5', 'CSV'),
    ).toThrow(/Row 1:/);
  });

  it('pool-master-qqs surfaces the format-level empty-input error', () => {
    expect(() => parseRosterUpload('', 'CSV')).toThrow('Paste or upload some rows first.');
  });
});

// plans/124 §6.3 Round scores / §6.4 — round-score bulk-upload parser.
describe('pool-master-r11 sport-admin-utils: parseGolfRoundScoreUpload', () => {
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

describe('sport-admin-utils: golfRoundScoreRows (issue 236)', () => {
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
