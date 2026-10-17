import { describe, expect, it } from 'vitest';
import {
  getSportDefinition,
  RaceResultStatus,
  ScoringFamily,
  Sport,
} from '@poolmaster/shared/domain';
import type {
  ContestEntryStandingDto,
  ContestLeaderboardResponse,
  ScoredContestEntryPickDto,
  SportEventParticipantDto,
} from '@/lib/api';
import { buildLeaderboardView } from '../contest-leaderboard';
import { getScoringFamilyUi } from './registry';
import { finishPositionUi, formatFinish } from './finish-position';

const horseRacing = getSportDefinition(Sport.HORSE_RACING);

function runner(
  race: Partial<NonNullable<SportEventParticipantDto['race']>> | null,
  overrides: Partial<SportEventParticipantDto> = {},
): SportEventParticipantDto {
  return {
    id: 'sep-1',
    sportEventId: 'event-1',
    participantId: 'participant-1',
    isActive: true,
    inactiveReason: null,
    ranking: null,
    oddsToWin: null,
    seedNumber: null,
    participant: {
      id: 'participant-1',
      sportId: 'sport-horse-racing',
      name: 'Arrow',
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
    race: race === null ? null : {
      finishPosition: 1,
      startPosition: null,
      resultStatus: RaceResultStatus.FINISHED,
      isOfficial: true,
      riderName: null,
      ...race,
    },
    affiliatedWithSportLeague: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

const pick: ScoredContestEntryPickDto = {
  pickId: 'pick-1',
  sportEventParticipantId: 'sep-1',
  pickedAt: '2026-04-01T00:00:00.000Z',
  slot: null,
  isCounting: true,
  isDropped: false,
  golf: null,
  race: { points: 5 },
  knockout: null,
};

const entry: ContestEntryStandingDto = {
  entryId: 'entry-1',
  entryName: 'Entry 1',
  entryNumber: 1,
  squadId: 'squad-1',
  squadName: 'Squad',
  status: 'SUBMITTED',
  position: 1,
  displayPosition: '1',
  countingPickLimit: 3,
  scoredPickCount: 1,
  totalScore: 8,
  picks: [pick],
};

function raceLeaderboard(participants: SportEventParticipantDto[]): ContestLeaderboardResponse {
  return {
    contestId: 'contest-1',
    sportEventId: 'event-1',
    sport: Sport.HORSE_RACING,
    scoringDefinitionId: 'FINISH_POSITION_POINTS',
    countingRule: { type: 'BEST_N', count: 3 },
    participants,
    entries: [entry],
    asOf: null,
  };
}

describe('finish-position leaderboard', () => {
  it('is the entry horse racing resolves to through its sport definition', () => {
    expect(horseRacing.scoringFamily).toBe(ScoringFamily.FINISH_POSITION);
    expect(getScoringFamilyUi(horseRacing)).toBe(finishPositionUi);
  });

  it('heads one Finish column after the total', () => {
    const board = finishPositionUi.leaderboard(raceLeaderboard([runner({})]), horseRacing);
    expect(board.detailColumns.map((column) => [column.key, column.label])).toEqual([['finish', 'Finish']]);
  });

  it('shows the entry total and the pick\'s points as plain points, and a dash while unscored', () => {
    const board = finishPositionUi.leaderboard(raceLeaderboard([runner({})]), horseRacing);
    const unscored = { ...raceLeaderboard([runner({})]), entries: [{ ...entry, totalScore: null }] };

    expect(buildLeaderboardView(raceLeaderboard([runner({})])).entries[0].total).toBe('8');
    expect(board.pickDetail('entry-1', pick, runner({})).total).toBe('5');
    expect(buildLeaderboardView(unscored).entries[0].total).toBeNull();
    expect(board.pickDetail('entry-1', { ...pick, race: { points: null } }, runner({})).total).toBeNull();
  });

  it('puts the runner\'s place in the pick\'s Finish cell under a test id naming the entry and pick', () => {
    const board = finishPositionUi.leaderboard(raceLeaderboard([runner({})]), horseRacing);
    const [cell] = board.pickDetail('entry-1', pick, runner({ finishPosition: 2 })).detailCells;
    expect([cell.testId, cell.text]).toEqual(['contest-leaderboard-pick-finish-entry-1-pick-1', '2']);
  });

  it('explains provisional places in a footnote only while a result on the board is not official', () => {
    expect(finishPositionUi.leaderboard(raceLeaderboard([runner({ isOfficial: false })]), horseRacing).footnote?.testId)
      .toBe('contest-leaderboard-provisional-note');
    expect(finishPositionUi.leaderboard(raceLeaderboard([runner({}), runner(null)]), horseRacing).footnote).toBeNull();
  });
});

describe('formatFinish', () => {
  it('shows a dead heat\'s shared place with the standing\'s "T"', () => {
    const tied = runner({ finishPosition: 2 }, {
      standing: { id: 'standing-1', position: 2, displayPosition: 'T2', status: 'COMPLETE', asOf: null, currentRound: null, golf: null },
    });
    expect(formatFinish(tied, horseRacing)).toBe('T2');
  });

  it.each([
    [RaceResultStatus.DID_NOT_FINISH, 'DNF'],
    [RaceResultStatus.DISQUALIFIED, 'DQ'],
    [RaceResultStatus.DID_NOT_START, 'DNS'],
  ])('shows a %s result as %s', (resultStatus, label) => {
    expect(formatFinish(runner({ resultStatus, finishPosition: null }), horseRacing)).toBe(label);
  });

  it('shows a scratched runner with no result in the sport\'s word, Scratched', () => {
    expect(formatFinish(runner(null, { isActive: false }), horseRacing)).toBe('Scratched');
  });

  it('shows nothing for a runner with no result yet, or a finisher not yet placed', () => {
    expect(formatFinish(runner(null), horseRacing)).toBeNull();
    expect(formatFinish(runner({ finishPosition: null, isOfficial: false }), horseRacing)).toBeNull();
  });
});
