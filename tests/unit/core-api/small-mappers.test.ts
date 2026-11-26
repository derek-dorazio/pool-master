/**
 * The short mappers (#1481): each one's nullable and optional fields, its rollups and its dates,
 * one named case per branch.
 */
import { AWAY_SIDE, HOME_SIDE, legacyMatch, type HomeAwayFields } from '../../support/match-sides';
import { expect } from '@jest/globals';
import type { LeaguePaymentRecord, PayerPaymentRecord } from '@poolmaster/shared/db';
import {
  compareByEnumOrder,
  ContestStatus,
  explicitOrderValues,
  LeaguePaymentKind,
  LeaguePlan,
  PlanCap,
  PlanFeature,
  PlanFeatureGroupOrder,
  PlanFeatureOrder,
  PredictedResult,
  ProviderCode,
  Sport,
  SurvivorWeekOutcome,
  getSportDefinition,
  type EmailMessage,
  type SportConfig,
  type SportEventRoundMatch,
  HomeAway,
  MatchEnding,
  MatchSide,
  MatchSideOutcome,
  PeriodKind,
  PeriodUnit,
} from '@poolmaster/shared/domain';
import { CUP_CUSTOM_POINTS_MAX, CUP_CUSTOM_POINTS_MAX_PLACES, GAME_PICKS_TIEBREAKER_MAX, SportLeaguePositionDtoSchema } from '@poolmaster/shared/dto';
import { buildLeague, buildProviderMapping, buildUser } from '../../factories';
import { toAuthResponse, toTokenRefreshResponse } from '../../../packages/core-api/src/mappers/auth.mapper';
import { toLeaguePaymentListResponse, toUserPaymentListResponse } from '../../../packages/core-api/src/mappers/billing.mapper';
import {
  toBracketLeaderboardSnapshotResponse,
} from '../../../packages/core-api/src/mappers/bracket-leaderboard.mapper';
import { toEmailTestResponseDto } from '../../../packages/core-api/src/mappers/email-test.mapper';
import { toGamePickPreviewResponse, toGamePicksResponse } from '../../../packages/core-api/src/mappers/game-picks.mapper';
import { mapGolfRoundScorePreviewToDto } from '../../../packages/core-api/src/mappers/golf-scores.mapper';
import { toLeagueDto } from '../../../packages/core-api/src/mappers/leagues.mapper';
import { toPlanFeatureGroupDtos } from '../../../packages/core-api/src/mappers/plans.mapper';
import { toPickEmLeaderboardSnapshotResponse } from '../../../packages/core-api/src/mappers/pick-em-leaderboard.mapper';
import { mapRaceResultPreviewToDto } from '../../../packages/core-api/src/mappers/race-results.mapper';
import { toSelectionGroupDto } from '../../../packages/core-api/src/mappers/selections.mapper';
import {
  mapRankingUploadPreviewRowToDto,
  mapSportLeaguePositionToDto,
  mapSportLeagueToDto,
  mapSportToDto,
} from '../../../packages/core-api/src/mappers/sport-catalog.mapper';
import { mapSportEventRoundMatchToDto } from '../../../packages/core-api/src/mappers/sport-event-matches.mapper';
import { toSquaresBoardResponse } from '../../../packages/core-api/src/mappers/squares.mapper';
import { toSurvivorLeaderboardResponse, toSurvivorLeaderboardSnapshotResponse } from '../../../packages/core-api/src/mappers/survivor-leaderboard.mapper';
import type { GolfScorePreviewRow } from '../../../packages/core-api/src/modules/golf/golf-score-service';
import type { PlanEntitlements } from '../../../packages/core-api/src/modules/plans/plan-entitlements-service';
import type { RaceResultPreviewRow } from '../../../packages/core-api/src/modules/scoring-families/finish-position/race-result-service';
import type { GamePickGame, GamePicksView, GamesPreview } from '../../../packages/core-api/src/modules/selections/prediction-service';
import { expectDefined } from '../../support/expect-defined';
import type { SquaresBoard } from '../../../packages/core-api/src/modules/selections/squares-service';
import type { SelectionGroup } from '../../../packages/core-api/src/modules/selections/types';
import type { SportLeagueSummary } from '../../../packages/core-api/src/modules/sport-catalog/sport-league-service';
import { weekRoundSlot } from '../../support/round-slots';

const AT = new Date('2026-03-01T12:00:00.000Z');
const ISO = AT.toISOString();

function match(overrides: HomeAwayFields & Partial<SportEventRoundMatch> = {}): SportEventRoundMatch {
  return legacyMatch({
    id: 'm1',
    sportEventId: 'e1',
    roundNumber: 1,
    slot: weekRoundSlot(),
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
    ending: MatchEnding.PLAYED,
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
    homeSpread: null,
    periodScores: [],
    ...overrides,
  });
}

describe('mapSportLeaguePositionToDto', () => {
  it('gives a position its code, display order, field eligibility and each provider\'s code for it, in the order read', () => {
    const position = {
      id: '11111111-1111-4111-8111-111111111111', code: 'QB', displayOrder: 1, isFieldEligible: true,
      providerCodes: [
        { providerCode: 'QB', provider: ProviderCode.BALLDONTLIE, providerLeagueCode: 'nfl', providerLeagueName: 'NFL' },
        { providerCode: 'Q', provider: ProviderCode.BALLDONTLIE, providerLeagueCode: 'nfl', providerLeagueName: 'NFL' },
      ],
    };

    expect(SportLeaguePositionDtoSchema.parse(mapSportLeaguePositionToDto(position))).toEqual(position);
  });
});

describe('mapSportEventRoundMatchToDto', () => {
  it('sends the scheduled date as ISO, each side with its team, outcome, summed score and spread, and Game 1\'s side results with where each played and their running period scores', () => {
    const dto = mapSportEventRoundMatchToDto(match({
      status: 'COMPLETED',
      winnerSide: MatchSide.HOME,
      homeScore: 10,
      awayScore: 3,
      homeSpread: -3.5,
      periodScores: [{ periodNumber: 1, homeScore: 7, awayScore: 3 }],
    }));

    expect(dto.scheduledDate).toBe(ISO);
    expect(dto.sides).toEqual([
      { sideNumber: AWAY_SIDE, sportEventParticipantId: 'a', outcome: MatchSideOutcome.LOST, score: 3, spread: 3.5 },
      { sideNumber: HOME_SIDE, sportEventParticipantId: 'h', outcome: MatchSideOutcome.WON, score: 10, spread: null },
    ]);
    expect(dto.games.map((game) => [game.gameNumber, game.isFinal, game.sideResults])).toEqual([[1, true, [
      { sideNumber: AWAY_SIDE, score: 3, homeAway: HomeAway.AWAY, shootoutScore: null, periodScores: [{ kind: PeriodKind.REGULAR, periodNumber: 1, score: 3 }] },
      { sideNumber: HOME_SIDE, score: 10, homeAway: HomeAway.HOME, shootoutScore: null, periodScores: [{ kind: PeriodKind.REGULAR, periodNumber: 1, score: 7 }] },
    ]]]);
  });

  it('sends a level knockout game\'s shoot-out apart from its score and its periods', () => {
    const dto = mapSportEventRoundMatchToDto(match({ status: 'COMPLETED', winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 3, awayShootoutScore: 4 }));

    expect(expectDefined(dto.games[0]).sideResults.map((result) => [result.sideNumber, result.score, result.shootoutScore, result.periodScores])).toEqual([
      [AWAY_SIDE, 1, 4, []],
      [HOME_SIDE, 1, 3, []],
    ]);
  });

  it('sends where the winner moves on to as the next match and its side number, and none for the final', () => {
    expect(mapSportEventRoundMatchToDto(match({ advancesToMatchId: 'm9', advancesToSide: MatchSide.AWAY })).advancesTo).toEqual({ matchId: 'm9', sideNumber: AWAY_SIDE });
    expect(mapSportEventRoundMatchToDto(match()).advancesTo).toBeNull();
  });

  it('sends an unscheduled game\'s date as null', () => {
    expect(mapSportEventRoundMatchToDto(match({ scheduledDate: null })).scheduledDate).toBeNull();
  });

  it('sends a completed game\'s result time as ISO, and a game without a result\'s as null (#1889)', () => {
    expect(mapSportEventRoundMatchToDto(match({ status: 'COMPLETED', completedAt: AT })).completedAt).toBe(ISO);
    expect(mapSportEventRoundMatchToDto(match({ completedAt: null })).completedAt).toBeNull();
  });

  it('sends no games and no side scores for a match that has no Game 1 yet', () => {
    const dto = mapSportEventRoundMatchToDto({ ...match(), games: [] });

    expect([dto.games, dto.sides.map((side) => side.score)]).toEqual([[], [null, null]]);
  });

  it('sends a side with no result in Game 1 as 0 in the other side\'s running period scores, and no side result of its own', () => {
    const played = match({ periodScores: [{ periodNumber: 1, homeScore: 7, awayScore: 3 }] });
    const homeOnly = { ...played, games: played.games.map((game) => ({ ...game, sideResults: game.sideResults.filter((result) => result.sideNumber === HOME_SIDE) })) };

    expect(expectDefined(mapSportEventRoundMatchToDto(homeOnly).games[0]).sideResults.map((result) => [result.sideNumber, result.periodScores])).toEqual([
      [HOME_SIDE, [{ kind: PeriodKind.REGULAR, periodNumber: 1, score: 7 }]],
    ]);
  });
});

describe('toSquaresBoardResponse', () => {
  const board = (digits: SquaresBoard['digits']): SquaresBoard => ({
    contest: { id: 'c1', status: ContestStatus.OPEN },
    maxSquaresPerEntry: 10,
    periods: { unit: PeriodUnit.QUARTER, count: 4 },
    game: match(),
    rowTeamName: null,
    columnTeamName: 'Home',
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
    expect(dto).toEqual(expect.objectContaining({ contestId: 'c1', contestStatus: ContestStatus.OPEN, rowTeamName: null, columnTeamName: 'Home' }));
  });

  it('sends a drawn board\'s digits as copies with the draw time as ISO', () => {
    const rowDigits = [1, 2, 3];
    const dto = toSquaresBoardResponse(board({ rowDigits, columnDigits: [4, 5], drawnAt: AT } as unknown as SquaresBoard['digits']));

    expect(dto.digits).toEqual({ rowDigits: [1, 2, 3], columnDigits: [4, 5], drawnAt: ISO });
    expect(dto.digits?.rowDigits).not.toBe(rowDigits);
  });

  it('sends each winner\'s scores as the row side\'s (the away team\'s) and the column side\'s (the home team\'s)', () => {
    const winner = { periodNumber: 2, homeScore: 14, awayScore: 7, rowIndex: 7, columnIndex: 4, contestEntryId: 'e1', entryName: 'Pat' };
    const dto = toSquaresBoardResponse({ ...board(null), winners: [winner] });

    expect(dto.winners).toEqual([{ periodNumber: 2, rowScore: 7, columnScore: 14, rowIndex: 7, columnIndex: 4, contestEntryId: 'e1', entryName: 'Pat' }]);
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
    const user = buildUser({ id: 'u1' });

    const dto = toAuthResponse(user, tokens);

    expect(dto.tokens).toEqual({ accessToken: 'a', refreshToken: 'r', csrfToken: 'c', expiresIn: 900 });
    expect(dto.user.id).toBe('u1');
  });

  it('answers a refresh with the new tokens, never the session id', () => {
    expect(toTokenRefreshResponse(tokens)).toEqual({ accessToken: 'a', refreshToken: 'r', csrfToken: 'c', expiresIn: 900 });
  });
});

describe('toPlanFeatureGroupDtos', () => {
  it('lists the groups in their declared order and each group\'s features in PlanFeatureOrder, every feature in exactly one group', () => {
    const groups = toPlanFeatureGroupDtos();

    expect(groups.map((entry) => entry.group)).toEqual(explicitOrderValues(PlanFeatureGroupOrder));
    expect(groups.map((entry) => entry.group)).toEqual(['EMAILS', 'CHAMPIONSHIPS', 'HISTORY']);
    for (const { features } of groups) expect(features).toEqual([...features].sort(compareByEnumOrder(PlanFeatureOrder)));
    expect(groups.flatMap((entry) => entry.features).sort()).toEqual(Object.values(PlanFeature).sort());
  });
});

describe('toLeagueDto', () => {
  const entitlements: PlanEntitlements = {
    plan: LeaguePlan.PRO,
    caps: { [PlanCap.ENTRIES_PER_CONTEST]: 5, [PlanCap.SPORTS_LEAGUES_PER_YEAR]: null },
    features: new Set([PlanFeature.EMAIL_CONTEST_RESULTS, PlanFeature.EMAIL_CONTEST_OPENED]),
    commissionerSelectable: true,
  };
  const league = (description: string | undefined) => buildLeague({
    leagueCode: 'ABC',
    name: 'Office',
    description,
    createdAt: AT,
    planRenewsAt: AT,
  });

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

  it('sends the bounds a custom points table is saved under, so the settings form checks what the server checks', () => {
    expect(toLeagueDto(league(undefined), entitlements, { memberCount: 0, activeContestCount: 0 })).toEqual(expect.objectContaining({
      cupCustomPointsMax: CUP_CUSTOM_POINTS_MAX,
      cupCustomPointsMaxPlaces: CUP_CUSTOM_POINTS_MAX_PLACES,
    }));
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
    const sport = { id: 's1', sport: 'GOLF', tournamentFormat: 'STROKE', createdAt: AT, updatedAt: AT } as unknown as SportConfig;

    expect(mapSportToDto(sport)).toEqual({ id: 's1', sport: 'GOLF', tournamentFormat: 'STROKE', createdAt: ISO, updatedAt: ISO });
  });

  it('sends a sport league with its counts, and its sport\'s name and ways of picking', () => {
    const summary = {
      id: 'sl1', sportId: 's1', sport: 'FOOTBALL', name: 'NFL', participantCount: 32, sportEventCount: 18, createdAt: AT, updatedAt: AT,
    } as unknown as SportLeagueSummary;

    const dto = mapSportLeagueToDto(summary);

    expect(dto).toEqual(expect.objectContaining({ participantCount: 32, sportEventCount: 18, createdAt: ISO }));
    expect(dto.sportName).toBe(getSportDefinition(Sport.FOOTBALL).name);
    expect(dto.selectionTypes).toEqual(getSportDefinition(Sport.FOOTBALL).selectionTypes);
    expect(dto.selectionTypes).not.toBe(getSportDefinition(Sport.FOOTBALL).selectionTypes);
  });

  it('sends a sport league\'s selected provider mapping as a copy with the provider\'s name, and null for a league not synced', () => {
    const base = { id: 'sl1', sportId: 's1', sport: 'FOOTBALL', name: 'NFL', participantCount: 0, sportEventCount: 0, createdAt: AT, updatedAt: AT };
    const mapping = buildProviderMapping({ providerLeagueCode: 'nfl', providerLeagueName: 'NFL' });

    const synced = mapSportLeagueToDto({ ...base, selectedProviderMapping: mapping } as unknown as SportLeagueSummary);

    expect(synced.selectedProviderMapping).toEqual(mapping);
    expect(synced.selectedProviderMapping).not.toBe(mapping);
    expect(synced.selectedProviderMapping?.providerName).toBe('BALLDONTLIE');
    expect(mapSportLeagueToDto({ ...base, selectedProviderMapping: null } as unknown as SportLeagueSummary).selectedProviderMapping).toBeNull();
  });

  it('sends a ranking upload row\'s resolution and participant', () => {
    expect(mapRankingUploadPreviewRowToDto({ row: 2, resolution: 'MATCHED', participantId: 'p1', participantName: 'Scottie' } as never))
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

describe('toSurvivorLeaderboardResponse', () => {
  it('sends each shown pick\'s game with its kickoff as an ISO time, a game with no kickoff as null, and a week with no shown pick as no game', () => {
    const game = {
      opponent: 'Raiders', opponentShortName: 'LV', side: 'HOME' as const, isNeutralSite: false,
      status: 'SCHEDULED' as const, teamScore: null, opponentScore: null,
    };
    const week = { sportEventId: 'e1', roundNumber: 1, outcome: null, team: 'Chiefs', teamShortName: 'KC' };
    const response = toSurvivorLeaderboardResponse({
      contestId: 'c1',
      weeks: [],
      entries: [{
        entryId: 'n1', entryName: 'Sharks 1', entryNumber: 1, squadId: 's1', squadName: 'Sharks', alive: true,
        eliminatedInWeek: null, weeksSurvived: 0, livesLeft: 1, livesLost: 0, position: 1, displayPosition: '1',
        weeks: [
          { ...week, game: { ...game, scheduledDate: AT } },
          { ...week, game: { ...game, scheduledDate: null } },
          { ...week, team: null, teamShortName: null, game: null },
        ],
      }],
    });

    expect(response.entries[0]?.weeks.map((shown) => (shown.game === null ? 'no game' : shown.game.scheduledDate))).toEqual([ISO, null, 'no game']);
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
    survivorOutcome: null,
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

  it('sends a game with no pick as a null pick, an unsubmitted entry\'s submission time as null, and the highest tiebreaker a save takes', () => {
    const dto = toGamePicksResponse(view([game({})], null));

    expect(dto.submittedAt).toBeNull();
    expect(dto.tiebreakerMax).toBe(GAME_PICKS_TIEBREAKER_MAX);
    expect(dto.games[0]).toEqual(expect.objectContaining({ sportEventRoundMatchId: 'm1', matchNumber: 3, kickoff: ISO, pick: null }));
  });

  it('sends an unscored pick\'s outcome and points as null', () => {
    const dto = toGamePicksResponse(view([game({ pick })], AT));

    expect(dto.submittedAt).toBe(ISO);
    expect(dto.games[0].pick).toEqual({
      predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'h', confidence: 2, pickedAt: ISO, outcome: null, points: null, survivorOutcome: null,
    });
  });

  it('sends a survivor pick\'s week outcome as the season decided it', () => {
    const dto = toGamePicksResponse(view([game({ pick, survivorOutcome: SurvivorWeekOutcome.LIFE_LOST })], AT));

    expect(dto.games[0].pick?.survivorOutcome).toBe(SurvivorWeekOutcome.LIFE_LOST);
  });

  it('sends a scored pick\'s outcome and points', () => {
    const pickScore = { outcome: 'CORRECT', points: 2 } as unknown as GamePickGame['pickScore'];

    const dto = toGamePicksResponse(view([game({ pick, pickScore })], AT));

    expect(dto.games[0].pick).toEqual(expect.objectContaining({ outcome: 'CORRECT', points: 2 }));
  });
});

describe('toGamePickPreviewResponse', () => {
  it('sends the highest tiebreaker a save takes with a setup\'s pick preview', () => {
    const preview = {
      sportEventId: 'e1',
      selectionType: 'PICK_EM',
      mode: null,
      againstTheSpread: false,
      tiePicksOffered: false,
      pickedCount: 0,
      gameCount: 0,
      tiebreakerMatchId: null,
      games: [],
    } as unknown as GamesPreview;

    const dto = toGamePickPreviewResponse(preview);

    expect(dto.tiebreakerMax).toBe(GAME_PICKS_TIEBREAKER_MAX);
    expect(dto).toEqual(expect.objectContaining({ sportEventId: 'e1', pickedCount: 0, gameCount: 0, games: [] }));
  });
});
