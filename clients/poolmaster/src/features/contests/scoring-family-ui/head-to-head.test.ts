import { describe, expect, it } from 'vitest';
import { getSportDefinition, ScoringFamily, Sport } from '@poolmaster/shared/domain';
import type {
  ContestEntryStandingDto,
  ContestLeaderboardResponse,
  ScoredContestEntryPickDto,
  SportEventParticipantDto,
} from '@/lib/api';
import { getScoringFamilyUi } from './registry';
import { formatKnockoutStatus, headToHeadUi } from './head-to-head';

const basketball = getSportDefinition(Sport.BASKETBALL);

function team(overrides: Partial<SportEventParticipantDto> = {}): SportEventParticipantDto {
  return {
    id: 'sep-1',
    sportEventId: 'event-1',
    participantId: 'participant-1',
    isActive: true,
    inactiveReason: null,
    ranking: null,
    oddsToWin: null,
    seedNumber: 12,
    isPlayInPlace: false,
    participant: {
      id: 'participant-1',
      sportId: 'sport-basketball',
      name: 'Vermont',
      participantType: 'TEAM',
      status: 'ACTIVE',
      injuryStatus: { status: 'HEALTHY' },
      externalIds: {},
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    },
    valuation: null,
    standing: null,
    rounds: [],
    race: null,
    affiliatedWithSportLeague: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function pick(knockout: ScoredContestEntryPickDto['knockout']): ScoredContestEntryPickDto {
  return {
    pickId: 'pick-1',
    sportEventParticipantId: 'sep-1',
    pickedAt: '2026-04-01T00:00:00.000Z',
    slot: null,
    isCounting: true,
    isDropped: false,
    golf: null,
    race: null,
    knockout,
  };
}

const upsetWin = pick({ points: 6, wins: 1, upsetBonusPoints: 5, isAlive: true });
const plainWin = pick({ points: 1, wins: 1, upsetBonusPoints: 0, isAlive: true });

function bracketLeaderboard(picks: ScoredContestEntryPickDto[]): ContestLeaderboardResponse {
  const entry: ContestEntryStandingDto = {
    entryId: 'entry-1',
    entryName: 'Entry 1',
    entryNumber: 1,
    squadId: 'squad-1',
    squadName: 'Squad',
    position: 1,
    displayPosition: '1',
    countingPickLimit: 4,
    scoredPickCount: picks.length,
    totalScore: 6,
    events: [{ sportEventId: 'event-1', totalScore: 6, position: 1, displayPosition: '1' }],
    picks,
  };
  return {
    contestId: 'contest-1',
    sportEventId: 'event-1',
    sport: Sport.BASKETBALL,
    scoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
    countingRule: { type: 'BEST_N', count: 4 },
    participants: [team()],
    entries: [entry],
    asOf: null,
  };
}

describe('head-to-head leaderboard', () => {
  it('is the entry basketball resolves to through its sport definition', () => {
    expect(basketball.scoringFamily).toBe(ScoringFamily.HEAD_TO_HEAD);
    expect(getScoringFamilyUi(basketball)).toBe(headToHeadUi);
  });

  it('heads Wins and Status after the total, and an Upset bonus column only when a pick earned a bonus', () => {
    const withBonus = headToHeadUi.leaderboard(bracketLeaderboard([upsetWin]), basketball);
    const withoutBonus = headToHeadUi.leaderboard(bracketLeaderboard([plainWin]), basketball);

    expect(withBonus.detailColumns.map((column) => column.label)).toEqual(['Wins', 'Upset bonus', 'Status']);
    expect(withoutBonus.detailColumns.map((column) => column.label)).toEqual(['Wins', 'Status']);
  });

  it('shows the pick\'s knockout points as its total with its wins, bonus and status in the cells', () => {
    const board = headToHeadUi.leaderboard(bracketLeaderboard([upsetWin]), basketball);
    const detail = board.pickDetail('entry-1', upsetWin, team());

    expect(detail.total).toBe('6');
    expect(detail.detailCells.map((cell) => [cell.testId, cell.text])).toEqual([
      ['contest-leaderboard-pick-wins-entry-1-pick-1', '1'],
      ['contest-leaderboard-pick-upset-bonus-entry-1-pick-1', '5'],
      ['contest-leaderboard-pick-status-entry-1-pick-1', 'Alive'],
    ]);
  });

  it('shows dashes for a pick not scored yet', () => {
    const unscored = pick({ points: null, wins: 0, upsetBonusPoints: 0, isAlive: true });
    const board = headToHeadUi.leaderboard(bracketLeaderboard([unscored]), basketball);
    const detail = board.pickDetail('entry-1', unscored, team());

    expect(detail.total).toBeNull();
    expect(detail.detailCells.map((cell) => cell.text)).toEqual([null, null]);
  });
});

describe('formatKnockoutStatus', () => {
  it('shows a team that lost as Eliminated, the sport\'s word', () => {
    expect(formatKnockoutStatus(pick({ points: 0, wins: 0, upsetBonusPoints: 0, isAlive: false }), team(), basketball)).toBe('Eliminated');
  });

  it('shows the team that won the final as Champion', () => {
    const champion = team({ standing: { id: 'standing-1', position: 1, displayPosition: '1', status: 'COMPLETE', asOf: null, currentRound: 2, golf: null } });
    expect(formatKnockoutStatus(plainWin, champion, basketball)).toBe('Champion');
  });

  it('shows a withdrawn team in the sport\'s word, and nothing for a team yet to play', () => {
    expect(formatKnockoutStatus(plainWin, team({ isActive: false }), basketball)).toBe('Withdrawn');
    expect(formatKnockoutStatus(pick({ points: 0, wins: 0, upsetBonusPoints: 0, isAlive: true }), team(), basketball)).toBeNull();
  });
});
