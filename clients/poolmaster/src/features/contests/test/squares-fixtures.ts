import { MatchEnding } from '@poolmaster/shared/domain';
import type {
  ContestDto,
  ContestEntryListResponse,
  LeagueContextResponse,
  SportEventMatchDto,
  SquaresBoardResponse,
} from '@/lib/api';
import { bracketEntriesFixture, bracketLeagueContextFixture } from './bracket-fixtures';

export const SQUARES_KICKOFF = '2099-02-07T23:30:00.000Z';

/** A squares contest on the Super Bowl, open for claims. */
export function squaresContestFixture(overrides: Partial<ContestDto> = {}): ContestDto {
  return {
    id: 'contest-1',
    leagueId: 'league-1',
    entriesPerContest: null,
    sport: 'AMERICAN_FOOTBALL',
    name: 'Super Bowl Squares',
    status: 'OPEN',
    contestFormat: 'SQUARES',
    selectionType: 'SQUARES',
    sportEvents: [{ sportEventId: 'event-1', sequence: 1, name: 'NFL Playoffs', startDate: '2099-01-10T18:00:00.000Z', endDate: null, status: 'IN_PROGRESS', participantType: null, scoringFamily: null }],
    ...overrides,
  };
}

/** One game of the event as the contract carries it. */
export function squaresGameFixture(overrides: Partial<SportEventMatchDto> = {}): SportEventMatchDto {
  return {
    id: 'game-1',
    sportEventId: 'event-1',
    roundNumber: 4,
    matchNumber: 13,
    homeSportEventParticipantId: 'field-eagles',
    awaySportEventParticipantId: 'field-chiefs',
    isNeutralSite: true,
    scheduledDate: SQUARES_KICKOFF,
    status: 'SCHEDULED',
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    homeShootoutScore: null,
    awayShootoutScore: null,
    ending: MatchEnding.PLAYED,
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
    homeSpread: null,
    periodScores: [],
    ...overrides,
  };
}

/** The board of an open contest: two entries, the viewer's entry-1 holding one box. */
export function squaresBoardFixture(overrides: Partial<SquaresBoardResponse> = {}): SquaresBoardResponse {
  return {
    contestId: 'contest-1',
    contestStatus: 'OPEN',
    maxSquaresPerEntry: 2,
    periodLayout: 'QUARTERS',
    game: squaresGameFixture(),
    homeTeamName: 'Eagles',
    awayTeamName: 'Chiefs',
    claimsOpen: true,
    drawOpen: true,
    boxes: [
      { rowIndex: 0, columnIndex: 0, contestEntryId: 'entry-1', entryName: 'Morgan’s Madness' },
      { rowIndex: 1, columnIndex: 1, contestEntryId: 'entry-2', entryName: 'Derek’s Great Golf Guys' },
    ],
    digits: null,
    winners: [],
    entries: [
      { contestEntryId: 'entry-2', entryName: 'Derek’s Great Golf Guys', boxCount: 1, periodsWon: 0, displayPosition: null },
      { contestEntryId: 'entry-1', entryName: 'Morgan’s Madness', boxCount: 1, periodsWon: 0, displayPosition: null },
    ],
    ...overrides,
  };
}

/** The digits as drawn: rows read 0 to 9 in order, columns start 3, 0, 1, 2. */
export const DRAWN_DIGITS: NonNullable<SquaresBoardResponse['digits']> = {
  rowDigits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  columnDigits: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9],
  drawnAt: '2099-02-07T20:00:00.000Z',
};

export function squaresEntriesFixture(overrides: Partial<ContestEntryListResponse> = {}): ContestEntryListResponse {
  return bracketEntriesFixture(overrides);
}

/** The league as its context read returns it: the viewer a member owning squad-1, or its commissioner. */
export function squaresLeagueContextFixture(role: 'MEMBER' | 'COMMISSIONER' = 'MEMBER'): LeagueContextResponse {
  const context = bracketLeagueContextFixture();
  return context.membership ? { ...context, membership: { ...context.membership, role } } : context;
}
