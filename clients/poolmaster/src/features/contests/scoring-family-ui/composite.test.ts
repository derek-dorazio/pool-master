import { describe, expect, it } from 'vitest';
import { eventSportDefinition, ParticipantType, ScoringFamily, Sport, SportStat } from '@poolmaster/shared/domain';
import type {
  ContestLeaderboardResponse,
  ScoredContestEntryPickDto,
  SportEventParticipantDto,
  SportEventParticipantRoundDto,
} from '@/lib/api';
import { compositeUi } from './composite';
import { getScoringFamilyUi } from './registry';

const worldSeries = eventSportDefinition({ sport: Sport.BASEBALL, participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.COMPOSITE });

function game(roundNumber: number, statLines: SportEventParticipantRoundDto['statLines']): SportEventParticipantRoundDto {
  return {
    id: `round-${roundNumber}`,
    sportEventRoundId: `event-round-${roundNumber}`,
    roundNumber,
    status: 'COMPLETED',
    completedAt: null,
    golf: null,
    statLines,
  };
}

function player(id: string, name: string, rounds: SportEventParticipantRoundDto[]): SportEventParticipantDto {
  return {
    id,
    sportEventId: 'event-1',
    participantId: `participant-${id}`,
    isActive: true,
    inactiveReason: null,
    ranking: 1,
    oddsToWin: null,
    seedNumber: null,
    isPlayInPlace: false,
    participant: {
      id: `participant-${id}`,
      sportId: 'sport-baseball',
      name,
      participantType: 'INDIVIDUAL',
      status: 'ACTIVE',
      injuryStatus: { status: 'HEALTHY' },
      externalIds: {},
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
    valuation: null,
    standing: null,
    rounds,
    race: null,
    affiliatedWithSportLeague: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

// Ohtani played Games 1 and 3; Rojas only Game 3, so Game 1 is DNP on his row.
const ohtani = player('sep-1', 'Shohei Ohtani', [
  game(1, [{ stat: SportStat.TOTAL_BASES, value: 1 }, { stat: SportStat.WALKS, value: 1 }]),
  game(3, [{ stat: SportStat.TOTAL_BASES, value: 12 }, { stat: SportStat.RUNS, value: 3 }, { stat: SportStat.RUNS_BATTED_IN, value: 3 }, { stat: SportStat.WALKS, value: 5 }]),
]);
const rojas = player('sep-2', 'Miguel Rojas', [game(3, [{ stat: SportStat.TOTAL_BASES, value: 4 }])]);

function pick(id: string, sportEventParticipantId: string, composite: ScoredContestEntryPickDto['composite']): ScoredContestEntryPickDto {
  return {
    pickId: id,
    sportEventParticipantId,
    pickedAt: '2026-10-20T00:00:00.000Z',
    slot: null,
    isCounting: true,
    isDropped: false,
    golf: null,
    race: null,
    knockout: null,
    composite,
  };
}

const ohtaniPick = pick('pick-1', 'sep-1', { points: 25, games: [{ roundNumber: 1, score: 2 }, { roundNumber: 3, score: 23 }] });
const rojasPick = pick('pick-2', 'sep-2', { points: 4, games: [{ roundNumber: 3, score: 4 }] });

const board: ContestLeaderboardResponse = {
  contestId: 'contest-1',
  sportEventId: 'event-1',
  sport: Sport.BASEBALL,
  participantType: ParticipantType.INDIVIDUAL,
  scoringFamily: ScoringFamily.COMPOSITE,
  scoringDefinitionId: 'COMPOSITE_TOTAL',
  countingRule: { type: 'BEST_N', count: 4, pickCount: 6 },
  participants: [ohtani, rojas],
  entries: [{
    entryId: 'entry-1',
    entryName: 'Blue Crew',
    entryNumber: 1,
    squadId: 'squad-1',
    squadName: 'Blue Crew',
    position: 1,
    displayPosition: '1',
    countingPickLimit: 4,
    scoredPickCount: 2,
    totalScore: 29,
    events: [{ sportEventId: 'event-1', totalScore: 29, position: 1, displayPosition: '1' }],
    picks: [ohtaniPick, rojasPick],
  }],
  asOf: null,
};

describe('composite leaderboard', () => {
  it('is what a stat pool event resolves to through its definition, where its sport alone would give a bracket', () => {
    expect(getScoringFamilyUi(worldSeries)).toBe(compositeUi);
  });

  it('heads one column per game any player has a line in, G1 and G3 when Game 2 is not in yet', () => {
    const view = compositeUi.leaderboard(board, worldSeries);

    expect(view.detailColumns.map((column) => column.label)).toEqual(['G1', 'G3']);
  });

  it('shows a pick\'s points as its total and each game\'s composite in its column, DNP for a finished game the player missed', () => {
    const view = compositeUi.leaderboard(board, worldSeries);

    expect(view.pickDetail('entry-1', ohtaniPick, ohtani)).toMatchObject({ total: '25', detailCells: [{ text: '2' }, { text: '23' }] });
    expect(view.pickDetail('entry-1', rojasPick, rojas)).toMatchObject({ total: '4', detailCells: [{ text: 'DNP' }, { text: '4' }] });
  });

  it('opens a game\'s score to that game\'s stats, each by its name, and gives a missed game nothing to open', () => {
    const view = compositeUi.leaderboard(board, worldSeries);

    expect(view.pickDetail('entry-1', ohtaniPick, ohtani).detailCells[1]?.peek).toEqual({
      title: 'G3 · Shohei Ohtani',
      facts: [
        { label: 'Total bases', value: '12' },
        { label: 'Runs', value: '3' },
        { label: 'Runs batted in', value: '3' },
        { label: 'Walks', value: '5' },
      ],
    });
    expect(view.pickDetail('entry-1', rojasPick, rojas).detailCells[0]?.peek).toBeUndefined();
  });

  it('puts the player\'s latest game under their name, named and with each unit written out', () => {
    const view = compositeUi.leaderboard(board, worldSeries);

    expect(view.pickDetail('entry-1', ohtaniPick, ohtani).statLine).toBe('G3: 12 TB · 3 runs · 3 RBI · 5 walks');
    expect(view.pickDetail('entry-1', rojasPick, rojas).statLine).toBe('G3: 4 TB');
  });

  it('names a player\'s own latest game when they missed the board\'s, rather than calling them absent', () => {
    const missedGame3 = player('sep-1', 'Shohei Ohtani', [game(1, [{ stat: SportStat.TOTAL_BASES, value: 1 }])]);
    const view = compositeUi.leaderboard({ ...board, participants: [missedGame3, rojas] }, worldSeries);

    expect(view.pickDetail('entry-1', ohtaniPick, missedGame3).statLine).toBe('G1: 1 TB');
  });

  it('shows the game being played on every line while it is live, and that a player not in it did not play, with a Live head on its column', () => {
    const liveGame4 = { ...game(4, [{ stat: SportStat.TOTAL_BASES, value: 2 }]), status: 'IN_PROGRESS' as const };
    const ohtaniLive = player('sep-1', 'Shohei Ohtani', [...ohtani.rounds, liveGame4]);
    const view = compositeUi.leaderboard({ ...board, participants: [ohtaniLive, rojas] }, worldSeries);

    expect(view.detailColumns.map((column) => [column.label, column.isLive ?? false])).toEqual([['G1', false], ['G3', false], ['G4', true]]);
    expect(view.pickDetail('entry-1', ohtaniPick, ohtaniLive).statLine).toBe('G4: 2 TB');
    expect(view.pickDetail('entry-1', rojasPick, rojas).statLine).toBe('G4: did not play');
    // Game 4 is still going, so a player without a score in it yet shows a dash, not DNP.
    expect(view.pickDetail('entry-1', rojasPick, rojas).detailCells[2]?.text).toBeNull();
  });

  it('heads no game columns for a single-game pool, where one would only repeat the total, and gives its line no game name', () => {
    const superBowl = eventSportDefinition({ sport: Sport.AMERICAN_FOOTBALL, participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.COMPOSITE });
    const mahomes = player('sep-1', 'Patrick Mahomes', [game(1, [
      { stat: SportStat.PASSING_TOUCHDOWNS, value: 3 },
      { stat: SportStat.RUSHING_TOUCHDOWNS, value: 0 },
      { stat: SportStat.PASSING_YARDS, value: 288 },
      { stat: SportStat.RUSHING_YARDS, value: 1 },
    ])]);
    const benched = player('sep-2', 'Carson Wentz', []);
    const view = compositeUi.leaderboard({ ...board, sport: Sport.AMERICAN_FOOTBALL, participants: [mahomes, benched] }, superBowl);

    expect(view.detailColumns).toEqual([]);
    expect(view.pickDetail('entry-1', ohtaniPick, mahomes)).toMatchObject({ detailCells: [], statLine: '3 pass TD · 288 pass yds · 1 rush yd' });
    expect(view.pickDetail('entry-1', rojasPick, benched).statLine).toBe('Did not play');
  });

  it('reads a line of zeros as its first stat rather than an empty line', () => {
    const quiet = player('sep-2', 'Miguel Rojas', [game(3, [{ stat: SportStat.TOTAL_BASES, value: 0 }, { stat: SportStat.WALKS, value: 0 }])]);
    const view = compositeUi.leaderboard({ ...board, participants: [ohtani, quiet] }, worldSeries);

    expect(view.pickDetail('entry-1', rojasPick, quiet).statLine).toBe('G3: 0 TB');
  });

  it('shows no total and no stat line on a player before the event\'s first game has lines', () => {
    const unscored = pick('pick-1', 'sep-1', { points: null, games: [] });
    const detail = compositeUi.leaderboard({ ...board, participants: [player('sep-1', 'Shohei Ohtani', [])] }, worldSeries)
      .pickDetail('entry-1', unscored, player('sep-1', 'Shohei Ohtani', []));

    expect(detail.total).toBeNull();
    expect(detail.statLine).toBeUndefined();
  });
});
