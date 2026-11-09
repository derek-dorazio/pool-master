/**
 * The short mappers (#1481): each one's nullable and optional fields, its rollups and its dates,
 * one named case per branch.
 */
import { expect } from '@jest/globals';
import type { LeaguePaymentRecord, PayerPaymentRecord } from '@poolmaster/shared/db';
import {
  ContestStatus,
  LeaguePaymentKind,
  LeaguePlan,
  PlanCap,
  PlanFeature,
  PredictedResult,
  type EmailMessage,
  type League,
  type ParticipantLeagueAffiliation,
  type SportConfig,
  type SportEventMatch,
  type User,
} from '@poolmaster/shared/domain';
import { toAuthResponse, toTokenRefreshResponse } from '../../../packages/core-api/src/mappers/auth.mapper';
import { toLeaguePaymentListResponse, toUserPaymentListResponse } from '../../../packages/core-api/src/mappers/billing.mapper';
import {
  toBracketLeaderboardSnapshotResponse,
} from '../../../packages/core-api/src/mappers/bracket-leaderboard.mapper';
import { toEmailTestResponseDto } from '../../../packages/core-api/src/mappers/email-test.mapper';
import { toGamePicksResponse } from '../../../packages/core-api/src/mappers/game-picks.mapper';
import { mapGolfRoundScorePreviewToDto } from '../../../packages/core-api/src/mappers/golf-scores.mapper';
import { toLeagueDto } from '../../../packages/core-api/src/mappers/leagues.mapper';
import { toPickEmLeaderboardSnapshotResponse } from '../../../packages/core-api/src/mappers/pick-em-leaderboard.mapper';
import { mapRaceResultPreviewToDto } from '../../../packages/core-api/src/mappers/race-results.mapper';
import { toSelectionGroupDto } from '../../../packages/core-api/src/mappers/selections.mapper';
import {
  mapAffiliationToDto,
  mapAffiliationUploadPreviewRowToDto,
  mapSportLeagueToDto,
  mapSportToDto,
} from '../../../packages/core-api/src/mappers/sport-catalog.mapper';
import { mapSportEventMatchToDto } from '../../../packages/core-api/src/mappers/sport-event-matches.mapper';
import { toSquaresBoardResponse } from '../../../packages/core-api/src/mappers/squares.mapper';
import { toSurvivorLeaderboardSnapshotResponse } from '../../../packages/core-api/src/mappers/survivor-leaderboard.mapper';
import type { GolfScorePreviewRow } from '../../../packages/core-api/src/modules/golf/golf-score-service';
import type { PlanEntitlements } from '../../../packages/core-api/src/modules/plans/plan-entitlements-service';
import type { RaceResultPreviewRow } from '../../../packages/core-api/src/modules/scoring-families/finish-position/race-result-service';
import type { GamePickGame, GamePicksView } from '../../../packages/core-api/src/modules/selections/prediction-service';
import type { SquaresBoard } from '../../../packages/core-api/src/modules/selections/squares-service';
import type { SelectionGroup } from '../../../packages/core-api/src/modules/selections/types';
import type { SportLeagueSummary } from '../../../packages/core-api/src/modules/sport-catalog/sport-league-service';

const AT = new Date('2026-03-01T12:00:00.000Z');
const ISO = AT.toISOString();

function match(overrides: Partial<SportEventMatch> = {}): SportEventMatch {
  return {
    id: 'm1',
    sportEventId: 'e1',
    roundNumber: 1,
    matchNumber: 3,
    homeSportEventParticipantId: 'h',
    awaySportEventParticipantId: 'a',
    isNeutralSite: false,
    scheduledDate: AT,
    status: 'SCHEDULED',
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    homeShootoutScore: null,
    awayShootoutScore: null,
    ending: null,
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
    homeSpread: null,
    periodScores: [],
    ...overrides,
  } as unknown as SportEventMatch;
}

describe('mapSportEventMatchToDto', () => {
  it('sends the scheduled date as ISO and each period score as its number and two scores only', () => {
    const dto = mapSportEventMatchToDto(match({
      periodScores: [{ periodNumber: 1, homeScore: 7, awayScore: 3, id: 'p1' }] as unknown as SportEventMatch['periodScores'],
    }));

    expect(dto.scheduledDate).toBe(ISO);
    expect(dto.periodScores).toEqual([{ periodNumber: 1, homeScore: 7, awayScore: 3 }]);
  });

  it('sends an unscheduled game\'s date as null', () => {
    expect(mapSportEventMatchToDto(match({ scheduledDate: null })).scheduledDate).toBeNull();
  });
});

describe('toSquaresBoardResponse', () => {
  const board = (digits: SquaresBoard['digits']): SquaresBoard => ({
    contest: { id: 'c1', status: ContestStatus.OPEN },
    maxSquaresPerEntry: 10,
    periodLayout: 'QUARTERS',
    game: match(),
    homeTeamName: 'Home',
    awayTeamName: null,
    claimsOpen: true,
    drawOpen: false,
    boxes: [],
    digits,
    winners: [],
    entries: [],
  } as unknown as SquaresBoard);

  it('sends an undrawn board\'s digits as null', () => {
    const dto = toSquaresBoardResponse(board(null));

    expect(dto.digits).toBeNull();
    expect(dto).toEqual(expect.objectContaining({ contestId: 'c1', contestStatus: ContestStatus.OPEN, awayTeamName: null }));
  });

  it('sends a drawn board\'s digits as copies with the draw time as ISO', () => {
    const rowDigits = [1, 2, 3];
    const dto = toSquaresBoardResponse(board({ rowDigits, columnDigits: [4, 5], drawnAt: AT } as unknown as SquaresBoard['digits']));

    expect(dto.digits).toEqual({ rowDigits: [1, 2, 3], columnDigits: [4, 5], drawnAt: ISO });
    expect(dto.digits?.rowDigits).not.toBe(rowDigits);
  });
});

describe('the upload previews count each resolution in their rollup', () => {
  it('counts a race result preview\'s matched, unresolved, ambiguous and invalid rows', () => {
    const row = (resolution: string, rowError: string | null): RaceResultPreviewRow => ({
      row: { position: 1, name: 'x' },
      resolution,
      sportEventParticipantId: null,
      participantName: null,
      rowError,
      change: null,
      before: null,
      after: {},
    } as unknown as RaceResultPreviewRow);

    const dto = mapRaceResultPreviewToDto({
      rows: [row('MATCHED', null), row('MATCHED', null), row('UNRESOLVED', 'NOT_FOUND'), row('AMBIGUOUS', null)],
      orderErrors: [],
    });

    expect(dto.rollup).toEqual({ total: 4, matched: 2, unresolved: 1, ambiguous: 1, invalid: 1 });
    expect(dto.rows[2]).toEqual(expect.objectContaining({ resolution: 'UNRESOLVED', rowError: 'NOT_FOUND' }));
  });

  it('counts a golf score preview\'s matched, unresolved and ambiguous rows', () => {
    const row = (resolution: string): GolfScorePreviewRow => ({
      row: { name: 'x' },
      resolution,
      sportEventParticipantId: null,
      participantName: null,
      change: 'UNCHANGED',
      before: null,
      after: {},
    } as unknown as GolfScorePreviewRow);

    const dto = mapGolfRoundScorePreviewToDto([row('MATCHED'), row('UNRESOLVED'), row('AMBIGUOUS'), row('AMBIGUOUS')]);

    expect(dto.rollup).toEqual({ total: 4, matched: 1, unresolved: 1, ambiguous: 2 });
    expect(dto.rows).toHaveLength(4);
  });
});

describe('billing mappers', () => {
  it('names a league payment\'s payer and sends a payment with no payer left as null', () => {
    const payment = (payer: LeaguePaymentRecord['payer']): LeaguePaymentRecord => ({
      id: 'p1',
      kind: LeaguePaymentKind.CONTEST_EXPANSION_GRANT,
      contest: null,
      payer,
      amountCents: 500,
      description: 'More entries',
      paidAt: AT,
    });

    const dto = toLeaguePaymentListResponse([
      payment({ id: 'u1', firstName: 'Ada', lastName: 'Lovelace', username: 'ada', email: 'ada@example.test' }),
      payment(null),
    ]);

    expect(dto.payments.map((line) => line.payer)).toEqual([{ id: 'u1', name: 'Ada Lovelace' }, null]);
    expect(dto.payments[0].paidAt).toBe(ISO);
  });

  it('sends a payer\'s payments with a copy of each one\'s league', () => {
    const league = { id: 'l1', name: 'Office', leagueCode: 'ABC' };
    const record: PayerPaymentRecord = { id: 'p1', league, amountCents: 900, description: 'Pro', paidAt: AT };

    const [line] = toUserPaymentListResponse([record]).payments;

    expect(line).toEqual({ id: 'p1', paidAt: ISO, amountCents: 900, description: 'Pro', league });
    expect(line.league).not.toBe(league);
  });
});

describe('toEmailTestResponseDto', () => {
  it('sends a sent message\'s missing skip reason and error as null', () => {
    expect(toEmailTestResponseDto({ status: 'SENT' } as unknown as EmailMessage))
      .toEqual({ status: 'SENT', skipReason: null, error: null });
  });

  it('sends a skipped or failed message\'s reason and last error', () => {
    expect(toEmailTestResponseDto({ status: 'FAILED', skipReason: 'DISABLED', lastError: 'boom' } as unknown as EmailMessage))
      .toEqual({ status: 'FAILED', skipReason: 'DISABLED', error: 'boom' });
  });
});

describe('auth mappers', () => {
  const tokens = { accessToken: 'a', refreshToken: 'r', csrfToken: 'c', expiresIn: 900, sessionId: 's' };

  it('answers a sign-in with the user and the tokens, never the session id', () => {
    const user: User = {
      id: 'u1', email: 'ada@example.test', username: 'ada', firstName: 'Ada', lastName: 'L', isActive: true, createdAt: AT, updatedAt: AT,
    };

    const dto = toAuthResponse(user, tokens);

    expect(dto.tokens).toEqual({ accessToken: 'a', refreshToken: 'r', csrfToken: 'c', expiresIn: 900 });
    expect(dto.user.id).toBe('u1');
  });

  it('answers a refresh with the new tokens, never the session id', () => {
    expect(toTokenRefreshResponse(tokens)).toEqual({ accessToken: 'a', refreshToken: 'r', csrfToken: 'c', expiresIn: 900 });
  });
});

describe('toLeagueDto', () => {
  const entitlements: PlanEntitlements = {
    plan: LeaguePlan.PRO,
    caps: { [PlanCap.ENTRIES_PER_CONTEST]: 5, [PlanCap.SPORTS_LEAGUES_PER_YEAR]: null },
    features: new Set([PlanFeature.EMAIL_CONTEST_RESULTS, PlanFeature.EMAIL_CONTEST_OPENED]),
    commissionerSelectable: true,
  };
  const league = (description: string | undefined) => ({
    id: 'l1',
    leagueCode: 'ABC',
    name: 'Office',
    description,
    isActive: true,
    iconKey: 'trophy',
    createdAt: AT,
    cupName: 'Cup',
    cupPointsScale: 'STANDARD',
    cupCustomPoints: null,
    hallOfLameVisible: true,
    planRenewsAt: AT,
    mutedSportLeagueIds: [],
  } as unknown as League);

  it('sends the plan\'s features in the published order and its counts as given', () => {
    const dto = toLeagueDto(league('Our pool'), entitlements, { memberCount: 4, activeContestCount: 2 });

    expect(dto.planEntitlements).toEqual({
      plan: LeaguePlan.PRO,
      caps: { [PlanCap.ENTRIES_PER_CONTEST]: 5, [PlanCap.SPORTS_LEAGUES_PER_YEAR]: null },
      features: [PlanFeature.EMAIL_CONTEST_OPENED, PlanFeature.EMAIL_CONTEST_RESULTS],
      commissionerSelectable: true,
    });
    expect(dto).toEqual(expect.objectContaining({ description: 'Our pool', memberCount: 4, activeContestCount: 2, planRenewsAt: ISO }));
  });

  it('sends a league with no description as null', () => {
    expect(toLeagueDto(league(undefined), entitlements, { memberCount: 0, activeContestCount: 0 }).description).toBeNull();
  });
});

describe('toSelectionGroupDto', () => {
  it('sends a participant\'s omitted role, team, status, price, ranking and order as null, and lists the selected ids', () => {
    const group: SelectionGroup = {
      groupId: 'g1',
      groupName: 'Tier 1',
      groupNumber: 1,
      picksFromGroup: 1,
      participants: [
        { sportEventParticipantId: 'sep1', participantId: 'p1', participantName: 'One', seedNumber: null, isAvailable: true, isSelected: true },
        {
          sportEventParticipantId: 'sep2',
          participantId: 'p2',
          participantName: 'Two',
          role: 'QB',
          teamAffiliation: 'KC',
          status: 'ACTIVE',
          price: 12,
          ranking: 3,
          seedNumber: 2,
          orderIndex: 1,
          isAvailable: false,
          isSelected: false,
        },
      ],
    };

    const dto = toSelectionGroupDto(group);

    expect(dto.selectedParticipantIds).toEqual(['sep1']);
    expect(dto.participants[0]).toEqual(expect.objectContaining({ role: null, team: null, status: null, price: null, ranking: null, orderIndex: null }));
    expect(dto.participants[1]).toEqual(expect.objectContaining({ role: 'QB', team: 'KC', status: 'ACTIVE', price: 12, ranking: 3, orderIndex: 1 }));
  });
});

describe('sport catalog mappers', () => {
  it('sends a sport with its dates as ISO', () => {
    const sport = { id: 's1', sport: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE', createdAt: AT, updatedAt: AT } as unknown as SportConfig;

    expect(mapSportToDto(sport)).toEqual({ id: 's1', sport: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE', createdAt: ISO, updatedAt: ISO });
  });

  it('sends a sport league with a copy of its round names and its counts', () => {
    const roundNames = ['Round 1', 'Final'];
    const summary = {
      id: 'sl1', sportId: 's1', sport: 'NFL', name: 'NFL', roundNames, affiliationCount: 32, sportEventCount: 18, createdAt: AT, updatedAt: AT,
    } as unknown as SportLeagueSummary;

    const dto = mapSportLeagueToDto(summary);

    expect(dto.roundNames).toEqual(roundNames);
    expect(dto.roundNames).not.toBe(roundNames);
    expect(dto).toEqual(expect.objectContaining({ affiliationCount: 32, sportEventCount: 18, createdAt: ISO }));
  });

  it('sends an affiliation with its participant embedded', () => {
    const affiliation = {
      id: 'a1',
      sportLeagueId: 'sl1',
      participantId: 'p1',
      ranking: 4,
      participant: { id: 'p1', name: 'Scottie', injuryStatus: { status: null, detail: null, expectedReturn: null, updatedAt: null }, createdAt: AT, updatedAt: AT },
      createdAt: AT,
      updatedAt: AT,
    } as unknown as ParticipantLeagueAffiliation;

    const dto = mapAffiliationToDto(affiliation);

    expect(dto).toEqual(expect.objectContaining({ id: 'a1', ranking: 4, createdAt: ISO }));
    expect(dto.participant.id).toBe('p1');
  });

  it('sends an affiliation upload row\'s resolution and participant', () => {
    expect(mapAffiliationUploadPreviewRowToDto({ row: 2, resolution: 'MATCHED', participantId: 'p1', participantName: 'Scottie' } as never))
      .toEqual({ row: 2, resolution: 'MATCHED', participantId: 'p1', participantName: 'Scottie' });
  });
});

describe('the stored leaderboards answer with the board they hold', () => {
  it.each([
    ['bracket', toBracketLeaderboardSnapshotResponse],
    ['pick\'em', toPickEmLeaderboardSnapshotResponse],
    ['survivor', toSurvivorLeaderboardSnapshotResponse],
  ] as const)('a %s snapshot answers with its board unchanged', (_label, map) => {
    const board = { contestId: 'c1' } as never;

    expect((map as (snapshot: { board: never }) => unknown)({ board })).toBe(board);
  });
});

describe('toGamePicksResponse', () => {
  const game = (overrides: Partial<GamePickGame>): GamePickGame => ({
    match: match(),
    kickoff: AT,
    home: null,
    away: null,
    predictedHome: null,
    predictedAway: null,
    locked: false,
    revealed: false,
    pick: null,
    pickScore: null,
    ...overrides,
  });
  const view = (games: GamePickGame[], submittedAt: Date | null): GamePicksView => ({
    contestId: 'c1',
    entryId: 'en1',
    entryName: 'Mine',
    sportEventId: 'e1',
    selectionType: 'PICK_EM',
    mode: null,
    againstTheSpread: false,
    tiePicksOffered: false,
    survivor: null,
    status: 'DRAFT',
    submittedAt,
    picksCloseAt: AT,
    ownEntry: true,
    canSubmit: true,
    pickedCount: 1,
    gameCount: 3,
    tiebreakerMatchId: null,
    tiebreakerValue: null,
    points: null,
    maxPossiblePoints: null,
    games,
  } as unknown as GamePicksView);
  const pick = { predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'h', confidence: 2, pickedAt: AT } as unknown as GamePickGame['pick'];

  it('sends a game with no pick as a null pick, and an unsubmitted entry\'s submission time as null', () => {
    const dto = toGamePicksResponse(view([game({})], null));

    expect(dto.submittedAt).toBeNull();
    expect(dto.games[0]).toEqual(expect.objectContaining({ sportEventMatchId: 'm1', matchNumber: 3, kickoff: ISO, pick: null }));
  });

  it('sends an unscored pick\'s outcome and points as null', () => {
    const dto = toGamePicksResponse(view([game({ pick })], AT));

    expect(dto.submittedAt).toBe(ISO);
    expect(dto.games[0].pick).toEqual({
      predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'h', confidence: 2, pickedAt: ISO, outcome: null, points: null,
    });
  });

  it('sends a scored pick\'s outcome and points', () => {
    const pickScore = { outcome: 'CORRECT', points: 2 } as unknown as GamePickGame['pickScore'];

    const dto = toGamePicksResponse(view([game({ pick, pickScore })], AT));

    expect(dto.games[0].pick).toEqual(expect.objectContaining({ outcome: 'CORRECT', points: 2 }));
  });
});
