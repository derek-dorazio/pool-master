import { describe, expect, it } from 'vitest';
import type {
  ContestLeaderboardResponse,
  ScoredContestEntryPickDto,
  SportEventParticipantDto,
  SportEventParticipantRoundDto,
} from '@/lib/api';
import {
  buildLeaderboardView,
  formatCurrentRoundLabel,
  formatThru,
  resolveCurrentRound,
  resolveRoundNumbers,
} from './contest-leaderboard';

function roundFixture(
  overrides: Partial<SportEventParticipantRoundDto> & { roundNumber: number },
): SportEventParticipantRoundDto {
  return {
    id: `round-${overrides.roundNumber}`,
    sportEventRoundId: `event-round-${overrides.roundNumber}`,
    status: 'PENDING',
    completedAt: null,
    golf: null,
    ...overrides,
  };
}

function participantFixture(
  overrides: Partial<SportEventParticipantDto> & { id: string; name?: string },
): SportEventParticipantDto {
  const { name = 'Rory McIlroy', ...rest } = overrides;
  return {
    sportEventId: 'event-1',
    participantId: `participant-${overrides.id}`,
    isActive: true,
    inactiveReason: null,
    ranking: null,
    oddsToWin: null,
    seedNumber: null,
    participant: {
      id: `participant-${overrides.id}`,
      sportId: 'sport-golf',
      name,
      participantType: 'INDIVIDUAL',
      status: 'ACTIVE',
      injuryStatus: { status: 'HEALTHY' },
      externalIds: {},
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    },
    valuation: null,
    standing: null,
    rounds: [],
    affiliatedWithSportLeague: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...rest,
  };
}

function standingFixture(eventScoreToPar: number) {
  return {
    id: 'standing-1',
    position: 1,
    displayPosition: '1',
    status: 'IN_PROGRESS' as const,
    asOf: '2026-04-11T18:00:00.000Z',
    currentRound: 2,
    golf: { eventScoreToPar, eventStrokes: 140, currentRoundThru: 18 },
  };
}

function pickFixture(
  overrides: Partial<ScoredContestEntryPickDto> & { pickId: string; sportEventParticipantId: string },
): ScoredContestEntryPickDto {
  return {
    pickedAt: '2026-04-01T00:00:00.000Z',
    slot: null,
    isCounting: true,
    isDropped: false,
    ...overrides,
  };
}

function responseFixture(
  overrides: Partial<ContestLeaderboardResponse> = {},
): ContestLeaderboardResponse {
  return {
    contestId: 'contest-1',
    sportEventId: 'event-1',
    scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
    countingRule: { type: 'BEST_N_GOLFERS', count: 2 },
    participants: [],
    entries: [],
    asOf: null,
    ...overrides,
  };
}

describe('resolveCurrentRound', () => {
  it('names no round when the field is empty', () => {
    expect(resolveCurrentRound([])).toBeNull();
  });

  it('names no round when the field has no round rows at all', () => {
    expect(resolveCurrentRound([participantFixture({ id: 'sep-1' })])).toBeNull();
  });

  it('names no round while every round is still pending, rather than guessing round 1', () => {
    expect(resolveCurrentRound([
      participantFixture({
        id: 'sep-1',
        rounds: [roundFixture({ roundNumber: 1 }), roundFixture({ roundNumber: 2 })],
      }),
    ])).toBeNull();
  });

  it('names the highest in-progress round', () => {
    expect(resolveCurrentRound([
      participantFixture({
        id: 'sep-1',
        rounds: [
          roundFixture({ roundNumber: 1, status: 'COMPLETED' }),
          roundFixture({ roundNumber: 2, status: 'IN_PROGRESS' }),
        ],
      }),
    ])).toEqual({ roundNumber: 2, isComplete: false });
  });

  it('prefers an in-progress round over a higher round another golfer has already finished', () => {
    // An early-tee-time golfer can finish round 3 while the field's late wave is still on
    // round 2. The leaderboard is on the round still being played.
    expect(resolveCurrentRound([
      participantFixture({
        id: 'sep-1',
        rounds: [roundFixture({ roundNumber: 3, status: 'COMPLETED' })],
      }),
      participantFixture({
        id: 'sep-2',
        rounds: [roundFixture({ roundNumber: 2, status: 'IN_PROGRESS' })],
      }),
    ])).toEqual({ roundNumber: 2, isComplete: false });
  });

  it('falls back to the highest completed round when nothing is in progress', () => {
    expect(resolveCurrentRound([
      participantFixture({
        id: 'sep-1',
        rounds: [
          roundFixture({ roundNumber: 1, status: 'COMPLETED' }),
          roundFixture({ roundNumber: 2, status: 'COMPLETED' }),
          roundFixture({ roundNumber: 3 }),
        ],
      }),
    ])).toEqual({ roundNumber: 2, isComplete: true });
  });

  it('counts both spellings of a finished round, since the column stores either', () => {
    expect(resolveCurrentRound([
      participantFixture({
        id: 'sep-1',
        rounds: [roundFixture({ roundNumber: 2, status: 'COMPLETE' })],
      }),
    ])).toEqual({ roundNumber: 2, isComplete: true });
  });

  it('treats a round that ended short as neither in progress nor complete', () => {
    // A withdrawal or a missed cut does not mean the field is on that round.
    expect(resolveCurrentRound([
      participantFixture({
        id: 'sep-1',
        rounds: [
          roundFixture({ roundNumber: 1, status: 'COMPLETED' }),
          roundFixture({ roundNumber: 2, status: 'MISSED_CUT' }),
          roundFixture({ roundNumber: 3, status: 'DNF' }),
        ],
      }),
    ])).toEqual({ roundNumber: 1, isComplete: true });
  });
});

describe('formatCurrentRoundLabel', () => {
  it('says nothing when there is no round to name', () => {
    expect(formatCurrentRoundLabel(null)).toBeNull();
  });

  it('labels a round still being played', () => {
    expect(formatCurrentRoundLabel({ roundNumber: 2, isComplete: false }))
      .toBe('Round 2 — In Progress');
  });

  it('labels a finished round', () => {
    expect(formatCurrentRoundLabel({ roundNumber: 4, isComplete: true }))
      .toBe('Round 4 — Complete');
  });
});

describe('resolveRoundNumbers', () => {
  it('returns no columns for a field with no rounds', () => {
    expect(resolveRoundNumbers([participantFixture({ id: 'sep-1' })])).toEqual([]);
  });

  it('unions the field\'s round numbers in order, without duplicating a shared round', () => {
    expect(resolveRoundNumbers([
      participantFixture({
        id: 'sep-1',
        rounds: [roundFixture({ roundNumber: 2 }), roundFixture({ roundNumber: 1 })],
      }),
      participantFixture({
        id: 'sep-2',
        rounds: [roundFixture({ roundNumber: 1 }), roundFixture({ roundNumber: 3 })],
      }),
    ])).toEqual([1, 2, 3]);
  });
});

describe('buildLeaderboardView', () => {
  const rory = participantFixture({
    id: 'sep-1',
    name: 'Rory McIlroy',
    standing: standingFixture(-5),
    rounds: [
      roundFixture({
        roundNumber: 1,
        status: 'COMPLETED',
        golf: { strokes: 68, scoreToPar: -3, thru: 18 },
      }),
      roundFixture({
        roundNumber: 2,
        status: 'IN_PROGRESS',
        golf: { strokes: 34, scoreToPar: -2, thru: 9 },
      }),
    ],
  });
  const scottie = participantFixture({
    id: 'sep-2',
    name: 'Scottie Scheffler',
    standing: standingFixture(-2),
    rounds: [
      roundFixture({
        roundNumber: 1,
        status: 'COMPLETED',
        golf: { strokes: 71, scoreToPar: 0, thru: 18 },
      }),
    ],
  });
  const unscored = participantFixture({
    id: 'sep-3',
    name: 'Ludvig Åberg',
    rounds: [roundFixture({ roundNumber: 1 }), roundFixture({ roundNumber: 2 })],
  });

  function entryFixture(overrides: Partial<ContestLeaderboardResponse['entries'][number]> = {}) {
    return {
      entryId: 'entry-1',
      entryName: 'Birdie Hunters Entry 1',
      entryNumber: 1,
      squadId: 'squad-1',
      squadName: 'Birdie Hunters',
      status: 'ACTIVE' as const,
      position: 1,
      displayPosition: '1',
      countingPickLimit: 2,
      scoredPickCount: 2,
      golf: { totalScoreToPar: -7 },
      picks: [],
      ...overrides,
    };
  }

  it('renders a finished round as strokes and the round being played as relative to par', () => {
    // The whole strokes-vs-to-par rule is the scoring definition's; this proves the view
    // routes each cell through it rather than deciding for itself.
    const view = buildLeaderboardView(responseFixture({
      participants: [rory],
      entries: [entryFixture({
        picks: [pickFixture({ pickId: 'pick-1', sportEventParticipantId: 'sep-1' })],
      })],
    }));

    expect(view.roundNumbers).toEqual([1, 2]);
    expect(view.entries[0].picks[0].rounds).toEqual(['68', '-2']);
    expect(view.entries[0].picks[0].total).toBe('-5');
  });

  it('keeps the server\'s order and its tie-aware display positions', () => {
    const view = buildLeaderboardView(responseFixture({
      participants: [rory, scottie],
      entries: [
        entryFixture({ entryId: 'entry-a', displayPosition: 'T1', golf: { totalScoreToPar: -7 } }),
        entryFixture({ entryId: 'entry-b', displayPosition: 'T1', golf: { totalScoreToPar: -7 } }),
        entryFixture({ entryId: 'entry-c', displayPosition: '3', golf: { totalScoreToPar: -2 } }),
      ],
    }));

    expect(view.entries.map((entry) => [entry.entryId, entry.displayPosition, entry.total]))
      .toEqual([
        ['entry-a', 'T1', '-7'],
        ['entry-b', 'T1', '-7'],
        ['entry-c', '3', '-2'],
      ]);
  });

  it('shows no total for an entry with nothing scored yet', () => {
    const view = buildLeaderboardView(responseFixture({
      participants: [unscored],
      entries: [entryFixture({
        displayPosition: null,
        scoredPickCount: 0,
        golf: { totalScoreToPar: null },
        picks: [pickFixture({
          pickId: 'pick-1',
          sportEventParticipantId: 'sep-3',
          isCounting: false,
        })],
      })],
    }));

    expect(view.entries[0].total).toBeNull();
    expect(view.entries[0].displayPosition).toBeNull();
    expect(view.entries[0].picks[0].total).toBeNull();
    expect(view.entries[0].picks[0].rounds).toEqual([null, null]);
  });

  it('shows no total for a contest with no golf extension on the standing', () => {
    const view = buildLeaderboardView(responseFixture({
      participants: [rory],
      entries: [entryFixture({ golf: null, picks: [] })],
    }));

    expect(view.entries[0].total).toBeNull();
  });

  it('carries the dropped flag through for the picks that fall outside the counting places', () => {
    const view = buildLeaderboardView(responseFixture({
      participants: [rory, scottie],
      entries: [entryFixture({
        countingPickLimit: 1,
        scoredPickCount: 2,
        golf: { totalScoreToPar: -5 },
        picks: [
          pickFixture({ pickId: 'pick-1', sportEventParticipantId: 'sep-1' }),
          pickFixture({
            pickId: 'pick-2',
            sportEventParticipantId: 'sep-2',
            isCounting: false,
            isDropped: true,
          }),
        ],
      })],
    }));

    expect(view.entries[0].picks.map((pick) => [pick.participantName, pick.isDropped])).toEqual([
      ['Rory McIlroy', false],
      ['Scottie Scheffler', true],
    ]);
  });

  it('reports an entry holding fewer scored picks than the counting rule allows', () => {
    // A three-of-five entry on day one, with one golfer posted: the rule still says three.
    const view = buildLeaderboardView(responseFixture({
      participants: [rory],
      entries: [entryFixture({
        countingPickLimit: 3,
        scoredPickCount: 1,
        golf: { totalScoreToPar: -5 },
        picks: [pickFixture({ pickId: 'pick-1', sportEventParticipantId: 'sep-1' })],
      })],
    }));

    expect(view.entries[0].countingPickLimit).toBe(3);
    expect(view.entries[0].scoredPickCount).toBe(1);
    expect(view.entries[0].picks).toHaveLength(1);
  });

  it('drops a pick whose pointer does not resolve to a field row', () => {
    // A pick is a pointer into `participants`; one that resolves to nothing has no golfer to
    // name, so it contributes no row.
    const view = buildLeaderboardView(responseFixture({
      participants: [rory],
      entries: [entryFixture({
        picks: [
          pickFixture({ pickId: 'pick-1', sportEventParticipantId: 'sep-1' }),
          pickFixture({ pickId: 'pick-2', sportEventParticipantId: 'sep-missing' }),
        ],
      })],
    }));

    expect(view.entries[0].picks.map((pick) => pick.pickId)).toEqual(['pick-1']);
  });

  it('pads a golfer\'s row to the field\'s round columns', () => {
    // Scottie has only round 1; Rory's round 2 still creates the column, so the cell is a gap
    // rather than a shifted score.
    const view = buildLeaderboardView(responseFixture({
      participants: [rory, scottie],
      entries: [entryFixture({
        picks: [
          pickFixture({ pickId: 'pick-1', sportEventParticipantId: 'sep-1' }),
          pickFixture({ pickId: 'pick-2', sportEventParticipantId: 'sep-2' }),
        ],
      })],
    }));

    expect(view.roundNumbers).toEqual([1, 2]);
    expect(view.entries[0].picks[1].rounds).toEqual(['71', null]);
  });

  it('carries the current-round cue off the same response', () => {
    expect(buildLeaderboardView(responseFixture({ participants: [rory] })).currentRoundLabel)
      .toBe('Round 2 — In Progress');
    expect(buildLeaderboardView(responseFixture({ participants: [unscored] })).currentRoundLabel)
      .toBeNull();
  });

  it('returns no entries for a contest nobody has entered', () => {
    const view = buildLeaderboardView(responseFixture({ participants: [rory] }));

    expect(view.entries).toEqual([]);
    expect(view.roundNumbers).toEqual([1, 2]);
  });
});

describe('formatThru', () => {
  function golferOnRound2(
    status: 'ACTIVE' | 'IN_PROGRESS' | 'COMPLETE' | 'WITHDRAWN' | 'ELIMINATED',
    currentRoundThru: number | null,
    round2Status: string,
  ) {
    return participantFixture({
      id: 'sep-1',
      standing: { ...standingFixture(-3), status, golf: { eventScoreToPar: -3, eventStrokes: 105, currentRoundThru } },
      rounds: [
        roundFixture({ roundNumber: 1, status: 'COMPLETED' }),
        roundFixture({ roundNumber: 2, status: round2Status }),
      ],
    });
  }

  it('shows the last hole completed while the golfer is mid-round', () => {
    expect(formatThru(golferOnRound2('IN_PROGRESS', 12, 'IN_PROGRESS'))).toBe('12');
  });

  it('shows F once the golfer\'s current round is complete', () => {
    expect(formatThru(golferOnRound2('IN_PROGRESS', 18, 'COMPLETED'))).toBe('F');
  });

  it('shows F for a golfer whose event is complete', () => {
    expect(formatThru(golferOnRound2('COMPLETE', 18, 'COMPLETED'))).toBe('F');
  });

  it('shows CUT for an eliminated golfer, even with holes recorded on the round', () => {
    expect(formatThru(golferOnRound2('ELIMINATED', 18, 'MISSED_CUT'))).toBe('CUT');
  });

  it('shows WD for a withdrawn golfer, even mid-round', () => {
    expect(formatThru(golferOnRound2('WITHDRAWN', 7, 'IN_PROGRESS'))).toBe('WD');
  });

  it('shows a dash before the golfer tees off, whether thru is unset or zero', () => {
    expect(formatThru(golferOnRound2('ACTIVE', null, 'PENDING'))).toBeNull();
    expect(formatThru(golferOnRound2('ACTIVE', 0, 'PENDING'))).toBeNull();
  });

  it('shows a dash for a golfer with no standing yet', () => {
    expect(formatThru(participantFixture({ id: 'sep-1' }))).toBeNull();
  });
});
