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

// Ohtani played Games 1 and 3; Rojas only Game 3, so Game 1 is a dash on his row.
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
  countingRule: { type: 'BEST_N', count: 4 },
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

  it('shows a pick\'s points as its total and each game\'s composite in its column, a dash for a game the player did not play', () => {
    const view = compositeUi.leaderboard(board, worldSeries);

    expect(view.pickDetail('entry-1', ohtaniPick, ohtani)).toMatchObject({ total: '25', detailCells: [{ text: '2' }, { text: '23' }] });
    expect(view.pickDetail('entry-1', rojasPick, rojas)).toMatchObject({ total: '4', detailCells: [{ text: null }, { text: '4' }] });
  });

  it('opens a player\'s row to each game\'s stats in Box Score\'s order, and says when they did not play a game', () => {
    const view = compositeUi.leaderboard(board, worldSeries);

    expect(view.pickDetail('entry-1', ohtaniPick, ohtani).breakdown?.lines).toEqual([
      { key: 'game-1', label: 'Game 1', text: '2 (1 TB, 1 BB)' },
      { key: 'game-3', label: 'Game 3', text: '23 (12 TB, 3 R, 3 RBI, 5 BB)' },
    ]);
    expect(view.pickDetail('entry-1', rojasPick, rojas).breakdown?.lines.map((line) => line.text)).toEqual(['Did not play', '4 (4 TB)']);
  });

  it('shows no total before the event\'s first game has lines', () => {
    const unscored = pick('pick-1', 'sep-1', { points: null, games: [] });

    expect(compositeUi.leaderboard({ ...board, participants: [player('sep-1', 'Shohei Ohtani', [])] }, worldSeries)
      .pickDetail('entry-1', unscored, player('sep-1', 'Shohei Ohtani', [])).total).toBeNull();
  });
});
