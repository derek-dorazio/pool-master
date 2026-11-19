import { describe, expect, it } from 'vitest';
import { getSportDefinition, ScoringFamily, Sport } from '@poolmaster/shared/domain';
import type {
  ContestEntryStandingDto,
  ContestLeaderboardResponse,
  ScoredContestEntryPickDto,
  SportEventMatchDto,
  SportEventParticipantDto,
} from '@/lib/api';
import { getScoringFamilyUi } from './registry';
import { formatKnockoutStatus, headToHeadUi } from './head-to-head';
import type { LeaderboardContext } from './types';

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
      sportLeagueId: 'league-basketball',
      ranking: null,
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
    composite: null,
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
    participantType: null,
    scoringFamily: null,
    scoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
    countingRule: { type: 'BEST_N', count: 4, pickCount: 6 },
    upsetBonus: false,
    participants: [team()],
    entries: [entry],
    asOf: null,
  };
}

function game(overrides: Partial<SportEventMatchDto> & Pick<SportEventMatchDto, 'matchNumber' | 'roundNumber'>): SportEventMatchDto {
  return {
    id: `match-${String(overrides.matchNumber)}`,
    sportEventId: 'event-1',
    homeSportEventParticipantId: 'sep-1',
    awaySportEventParticipantId: 'sep-2',
    isNeutralSite: true,
    scheduledDate: '2026-03-28T22:09:00.000Z',
    status: 'SCHEDULED',
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    homeShootoutScore: null,
    awayShootoutScore: null,
    ending: 'PLAYED',
    resultSource: null,
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
    homeSpread: null,
    periodScores: [],
    ...overrides,
  };
}

const ROUND_NAMES = ['First Round', 'Round of 32', 'Sweet 16', 'Elite Eight', 'Final Four', 'National Championship'];

function context(games: SportEventMatchDto[]): LeaderboardContext {
  return {
    games,
    roundName: (roundNumber) => ROUND_NAMES[roundNumber - 1] ?? `Round ${String(roundNumber)}`,
    formatStart: (startsAt) => `start ${startsAt}`,
  };
}

const gonzaga = team({ id: 'sep-2', seedNumber: 4, participant: { ...team().participant, id: 'participant-2', name: 'Gonzaga' } });
const arizona = team({ id: 'sep-3', seedNumber: 2, participant: { ...team().participant, id: 'participant-3', name: 'Arizona' } });

/** Vermont (sep-1) beat Gonzaga in the first round, then lost to Arizona in the second, Vermont at home both times. */
const vermontOutInRoundOfThirtyTwo = [
  game({ matchNumber: 1, roundNumber: 1, status: 'COMPLETED', winnerSide: 'HOME', homeScore: 81, awayScore: 76 }),
  game({ matchNumber: 9, roundNumber: 2, awaySportEventParticipantId: 'sep-3', status: 'COMPLETED', winnerSide: 'AWAY', homeScore: 70, awayScore: 74 }),
];

describe('head-to-head leaderboard', () => {
  it('is the entry basketball resolves to through its sport definition', () => {
    expect(basketball.scoringFamily).toBe(ScoringFamily.HEAD_TO_HEAD);
    expect(getScoringFamilyUi(basketball)).toBe(headToHeadUi);
  });

  it('heads Wins and Status after the total, and an Upset column only when the contest has the bonus on, earned or not', () => {
    const bonusOn = headToHeadUi.leaderboard({ ...bracketLeaderboard([plainWin]), upsetBonus: true }, basketball);
    const bonusOff = headToHeadUi.leaderboard(bracketLeaderboard([upsetWin]), basketball);

    expect(bonusOn.detailColumns.map((column) => column.label)).toEqual(['Wins', 'Upset', 'Status']);
    expect(bonusOff.detailColumns.map((column) => column.label)).toEqual(['Wins', 'Status']);
  });

  it('shows the pick\'s knockout points as its total, its wins, its upset bonus as +N and a green In chip while it is still in', () => {
    const board = headToHeadUi.leaderboard({ ...bracketLeaderboard([upsetWin]), upsetBonus: true }, basketball);
    const detail = board.pickDetail('entry-1', upsetWin, team());

    expect(detail.total).toBe('6');
    expect(detail.detailCells.map((cell) => [cell.testId, cell.text, cell.chip])).toEqual([
      ['contest-leaderboard-pick-wins-entry-1-pick-1', '1', undefined],
      ['contest-leaderboard-pick-upset-bonus-entry-1-pick-1', '+5', undefined],
      ['contest-leaderboard-pick-status-entry-1-pick-1', 'In', 'success'],
    ]);
  });

  it('shows a dash, not +0, for a team with no upset bonus', () => {
    const board = headToHeadUi.leaderboard({ ...bracketLeaderboard([plainWin]), upsetBonus: true }, basketball);

    expect(board.pickDetail('entry-1', plainWin, team()).detailCells[1]?.text).toBeNull();
  });

  it('shows dashes for a pick not scored yet', () => {
    const unscored = pick({ points: null, wins: 0, upsetBonusPoints: 0, isAlive: true });
    const board = headToHeadUi.leaderboard(bracketLeaderboard([unscored]), basketball);
    const detail = board.pickDetail('entry-1', unscored, team());

    expect(detail.total).toBeNull();
    expect(detail.detailCells[0]?.text).toBeNull();
  });

  it('puts the team\'s latest game under its name, with its round, result, opponent and score its way round', () => {
    const out = pick({ points: 1, wins: 1, upsetBonusPoints: 0, isAlive: false });
    const board = headToHeadUi.leaderboard({ ...bracketLeaderboard([out]), participants: [team(), gonzaga, arizona] }, basketball, context(vermontOutInRoundOfThirtyTwo));

    expect(board.pickDetail('entry-1', out, team()).statLine).toBe('Round of 32: lost to Arizona 70–\u206074');
  });

  it('names the opponent by its short name where the field has one, so the line fits a phone row', () => {
    const out = pick({ points: 1, wins: 1, upsetBonusPoints: 0, isAlive: false });
    const shortArizona = team({ ...arizona, participant: { ...arizona.participant, name: 'Arizona Wildcats', shortName: 'Arizona' } });
    const board = headToHeadUi.leaderboard({ ...bracketLeaderboard([out]), participants: [team(), gonzaga, shortArizona] }, basketball, context(vermontOutInRoundOfThirtyTwo));

    expect(board.pickDetail('entry-1', out, team()).statLine).toBe('Round of 32: lost to Arizona 70–⁠74');
  });

  it('opens Wins to every game the team played, by round', () => {
    const out = pick({ points: 1, wins: 1, upsetBonusPoints: 0, isAlive: false });
    const board = headToHeadUi.leaderboard({ ...bracketLeaderboard([out]), participants: [team(), gonzaga, arizona] }, basketball, context(vermontOutInRoundOfThirtyTwo));

    expect(board.pickDetail('entry-1', out, team()).detailCells[0]?.peek).toEqual({
      title: 'Vermont',
      facts: [
        { label: 'First Round', value: 'beat Gonzaga 81–\u206076' },
        { label: 'Round of 32', value: 'lost to Arizona 70–\u206074' },
      ],
    });
  });

  it('ends a team still in with its next game, its opponent and when it starts', () => {
    const games = [
      ...vermontOutInRoundOfThirtyTwo.slice(0, 1),
      game({ matchNumber: 9, roundNumber: 2, awaySportEventParticipantId: 'sep-3' }),
    ];
    const board = headToHeadUi.leaderboard({ ...bracketLeaderboard([plainWin]), participants: [team(), gonzaga, arizona] }, basketball, context(games));

    expect(board.pickDetail('entry-1', plainWin, team()).detailCells[0]?.peek?.facts.at(-1))
      .toEqual({ label: 'Round of 32', value: 'vs Arizona · start 2026-03-28T22:09:00.000Z' });
    expect(board.pickDetail('entry-1', plainWin, team()).statLine).toBe('First Round: beat Gonzaga 81–\u206076');
  });

  it('says a team still in is playing now while its next game is live, and names an opponent not decided yet as TBD', () => {
    const games = [game({ matchNumber: 9, roundNumber: 2, awaySportEventParticipantId: null, status: 'IN_PROGRESS' })];
    const board = headToHeadUi.leaderboard({ ...bracketLeaderboard([plainWin]), participants: [team()] }, basketball, context(games));

    expect(board.pickDetail('entry-1', plainWin, team()).detailCells[0]?.peek?.facts).toEqual([
      { label: 'Round of 32', value: 'vs TBD · playing now' },
    ]);
  });

  it('opens nothing and shows no line under the name where the board has not read the games', () => {
    const detail = headToHeadUi.leaderboard(bracketLeaderboard([plainWin]), basketball).pickDetail('entry-1', plainWin, team());

    expect(detail.detailCells[0]?.peek).toBeUndefined();
    expect(detail.statLine).toBeUndefined();
  });
});

describe('formatKnockoutStatus', () => {
  it('names the round a team went out in, in full, on a grey chip', () => {
    const out = pick({ points: 1, wins: 1, upsetBonusPoints: 0, isAlive: false });
    expect(formatKnockoutStatus(out, team(), basketball, context(vermontOutInRoundOfThirtyTwo))).toEqual({ text: 'Out · Round of 32', chip: 'neutral' });
  });

  it('names the round for every elimination round, Sweet 16 and Elite Eight alike', () => {
    const out = pick({ points: 3, wins: 2, upsetBonusPoints: 0, isAlive: false });
    for (const [roundNumber, name] of [[3, 'Sweet 16'], [4, 'Elite Eight']] as const) {
      const lost = [game({ matchNumber: 20, roundNumber, status: 'COMPLETED', winnerSide: 'AWAY', homeScore: 60, awayScore: 70 })];
      expect(formatKnockoutStatus(out, team(), basketball, context(lost)).text).toBe(`Out · ${name}`);
    }
  });

  it('says Out alone for a team that lost where the board has not read the games', () => {
    expect(formatKnockoutStatus(pick({ points: 0, wins: 0, upsetBonusPoints: 0, isAlive: false }), team(), basketball)).toEqual({ text: 'Out', chip: 'neutral' });
  });

  it('shows the team that won the final as Champion', () => {
    const champion = team({ standing: { id: 'standing-1', position: 1, displayPosition: '1', status: 'COMPLETE', asOf: null, currentRound: 2, golf: null } });
    expect(formatKnockoutStatus(plainWin, champion, basketball)).toEqual({ text: 'Champion', chip: 'success' });
  });

  it('shows a withdrawn team in the sport\'s word, and nothing for a team with no knockout result', () => {
    expect(formatKnockoutStatus(plainWin, team({ isActive: false }), basketball)).toEqual({ text: 'Withdrawn', chip: 'neutral' });
    expect(formatKnockoutStatus(pick(null), team(), basketball)).toEqual({ text: null });
  });
});
