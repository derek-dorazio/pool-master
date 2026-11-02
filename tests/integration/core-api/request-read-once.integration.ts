import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ContestStatus, SelectionType, Sport } from '@poolmaster/shared/domain';
import type {
  ContestResponse,
  LeagueContextResponse,
  SendLeagueInvitationsResponse,
  SquadListResponse,
  TeamOwnerInvitationResponse,
} from '@poolmaster/shared/dto';
import {
  buildContestEligibleEventTiming,
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import {
  recordStatements,
  statementCounts,
  statementParams,
  statementsOn,
  StatementVerb,
  type RecordedStatement,
} from '../statement-log';
import { freshEventEdition } from '../../support/event-edition';

// The routes #1355 brought under the request query budget, against Postgres: each reads the
// joiner, the team, the league and the contest's events once however many steps of the request
// need them, and sends exactly the statements pinned here. A count that moves is a read added
// or lost: look at which table moved before changing the pin. The two settling routes (a game's
// result, an event's status change) stay on the functional suite's query budget allow list
// (#1387), which stops counting them there, so these pins are what holds their counts.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const TIER_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** The request's response and every statement it sent. */
async function measureRequest(request: InjectOptions): Promise<{ response: LightMyRequestResponse; statements: RecordedStatement[] }> {
  const { result, statements } = await recordStatements(() => getApp().inject(request));
  return { response: result, statements };
}

/**
 * `statementCounts` without the mail outbox's tables: the outbox sends queued mail on its own,
 * so how many of its statements fall inside a record changes from run to run.
 */
function requestCounts(statements: readonly RecordedStatement[]): Array<[string, number]> {
  return statementCounts(statements).filter(([target]) => !target.includes(' email_'));
}

/** The reads of `table` sent with `value` among their values. */
function readsWith(statements: readonly RecordedStatement[], table: string, value: string): RecordedStatement[] {
  return statementsOn(statements, StatementVerb.SELECT, table)
    .filter((statement) => statementParams(statement).includes(value));
}

/** How many reads of one `table` row by its id alone: a point read, not a relation load. */
function pointReads(statements: readonly RecordedStatement[], table: string, id: string): number {
  return readsWith(statements, table, id).filter((statement) => /"id" = \$1\b/.test(statement.sql)).length;
}

/** A league made through the API, with its commissioner and the commissioner's team. */
async function leagueWithTeam() {
  const commissioner = await createTestUser();
  const created = await getApp().inject({
    method: 'POST',
    url: API_ROUTES.leagues.create,
    headers: commissioner.headers,
    payload: buildCreateLeaguePayload(`Read Once ${randomUUID().slice(0, 6)}`),
  });
  expect(created.statusCode).toBe(201);
  const leagueId = created.json<LeagueContextResponse>().league.id;
  const squads = await getApp().inject({ method: 'GET', url: API_ROUTES.squads.list(leagueId), headers: commissioner.headers });
  return { commissioner, leagueId, squadId: squads.json<SquadListResponse>().squads[0].id };
}

describe('Joining a league by invitation (#1355)', () => {
  it('reads the joiner once and sends a fixed set of statements when accepting a league invitation', async () => {
    const { commissioner, leagueId } = await leagueWithTeam();
    const joiner = await createTestUser();
    const invited = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: commissioner.headers,
      payload: { emails: [joiner.user.email] },
    });
    expect(invited.statusCode).toBe(201);

    const { response, statements } = await measureRequest({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: joiner.headers,
      payload: { inviteCode: invited.json<SendLeagueInvitationsResponse>().sent[0].inviteCode },
    });

    expect(response.statusCode).toBe(201);
    const { squadId } = await getPrisma().squadMembership.findUniqueOrThrow({ where: { leagueId_userId: { leagueId, userId: joiner.user.id } } });
    expect([pointReads(statements, 'users', joiner.user.id), pointReads(statements, 'squads', squadId)]).toEqual([1, 0]);
    expect(requestCounts(statements)).toEqual([
      ['INSERT league_memberships', 1],
      ['INSERT squad_memberships', 1],
      ['INSERT squads', 1],
      ['SELECT contests', 1],
      ['SELECT league_invitations', 1],
      ['SELECT league_memberships', 3],
      ['SELECT leagues', 1],
      ['SELECT squad_memberships', 3],
      ['SELECT squads', 3],
      ['SELECT users', 2],
      ['UPDATE league_invitations', 1],
    ]);
  });
});

describe('Adding a co-owner to a team (#1355)', () => {
  it('reads the invitee and the team once and sends a fixed set of statements when inviting a co-owner who has an account', async () => {
    const { commissioner, leagueId, squadId } = await leagueWithTeam();
    const invitee = await createTestUser();

    const { response, statements } = await measureRequest({
      method: 'POST',
      url: API_ROUTES.squads.createOwnerInvitation(leagueId, squadId),
      headers: commissioner.headers,
      payload: { email: invitee.user.email },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<TeamOwnerInvitationResponse>().invitation.status).toBe('ACCEPTED');
    expect([readsWith(statements, 'users', invitee.user.email).length, pointReads(statements, 'squads', squadId)]).toEqual([1, 1]);
    expect(requestCounts(statements)).toEqual([
      ['INSERT league_memberships', 1],
      ['INSERT squad_memberships', 1],
      ['INSERT squad_owner_invitations', 1],
      ['SELECT league_memberships', 5],
      ['SELECT leagues', 1],
      ['SELECT squad_memberships', 3],
      ['SELECT squad_owner_invitations', 1],
      ['SELECT squads', 2],
      ['SELECT users', 3],
      ['UPDATE squad_owner_invitations', 1],
    ]);
  });

  it('reads the new co-owner and the team once and sends a fixed set of statements when an invitee registers and joins', async () => {
    const { commissioner, leagueId, squadId } = await leagueWithTeam();
    const tag = randomUUID().slice(0, 8);
    const email = `read-once-${tag}@integration.test`;
    const invited = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.squads.createOwnerInvitation(leagueId, squadId),
      headers: commissioner.headers,
      payload: { email },
    });
    expect(invited.statusCode).toBe(201);

    const { response, statements } = await measureRequest({
      method: 'POST',
      url: '/api/v1/team-invitations/register',
      payload: {
        inviteCode: invited.json<TeamOwnerInvitationResponse>().invitation.inviteCode,
        username: `read-once-${tag}`,
        password: 'CorrectHorse9',
        firstName: 'Co',
        lastName: 'Owner',
      },
    });

    expect(response.statusCode).toBe(201);
    const { id: userId } = await getPrisma().user.findUniqueOrThrow({ where: { email } });
    expect([pointReads(statements, 'users', userId), pointReads(statements, 'squads', squadId)]).toEqual([1, 1]);
    expect(requestCounts(statements)).toEqual([
      ['INSERT league_memberships', 1],
      ['INSERT refresh_tokens', 1],
      ['INSERT squad_memberships', 1],
      ['INSERT users', 1],
      ['SELECT league_memberships', 4],
      ['SELECT leagues', 1],
      ['SELECT squad_memberships', 2],
      ['SELECT squad_owner_invitations', 2],
      ['SELECT squads', 2],
      ['SELECT users', 5],
      ['UPDATE squad_owner_invitations', 1],
    ]);
  });
});

/** A scheduled golf event with six tiers and a two-golfer field. */
async function tieredGolfEvent(name: string) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `read-once-${randomUUID()}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name,
      startDate: buildContestEligibleEventTiming().startDate,
      status: 'SCHEDULED',
    },
  });
  const tiers = [];
  for (const [index, tierKey] of TIER_KEYS.entries()) {
    tiers.push(await prisma.sportEventTier.create({ data: { sportEventId: event.id, tierKey, label: `Tier ${tierKey}`, tierNumber: index + 1 } }));
  }
  for (const [index, tier] of tiers.slice(0, 2).entries()) {
    const golfer = await prisma.participant.create({
      data: { sportId: sport.id, name: `Read Once Golfer ${randomUUID().slice(0, 6)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
    });
    const fieldRow = await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: golfer.id, isActive: true, ranking: index + 1 } });
    await prisma.sportEventParticipantValuation.create({
      data: { sportEventParticipantId: fieldRow.id, sportEventTierId: tier.id, tierOrderIndex: 1, tierAssignedSource: 'MANUAL' },
    });
  }
  return event;
}

describe('Opening a contest (#1355)', () => {
  it('reads a two-event tiered contest\'s events together, never one by one, and sends a fixed set of statements when opening it', async () => {
    const { commissioner, leagueId } = await leagueWithTeam();
    const first = await tieredGolfEvent(`Read Once Open ${randomUUID().slice(0, 6)}`);
    const second = await tieredGolfEvent(`Read Once Classic ${randomUUID().slice(0, 6)}`);
    const created = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: commissioner.headers,
      payload: {
        name: 'Read Once Picks',
        sportEventIds: [first.id, second.id],
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        configuration: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
      },
    });
    expect(created.statusCode).toBe(201);
    const contestId = created.json<ContestResponse>().contest.id;

    const { response, statements } = await measureRequest({
      method: 'POST',
      url: `${API_ROUTES.contestManagement.detail(leagueId, contestId)}/open`,
      headers: withoutJsonBodyHeaders(commissioner.headers),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ContestResponse>().contest.status).toBe(ContestStatus.OPEN);
    // Every read of the events or their tiers but one takes both events together; the one is the
    // first event's tiers for the reply's pick groups.
    const eachEvent = (table: string) => statementsOn(statements, StatementVerb.SELECT, table)
      .filter((statement) => !(statementParams(statement).includes(first.id) && statementParams(statement).includes(second.id))).length;
    expect([eachEvent('sport_events'), eachEvent('sport_event_tiers')]).toEqual([0, 1]);
    expect(requestCounts(statements)).toEqual([
      ['SELECT contest_configurations', 1],
      ['SELECT contest_draws', 2],
      ['SELECT contest_sport_events', 2],
      ['SELECT contest_squares_draws', 2],
      ['SELECT contest_squares_games', 2],
      ['SELECT contests', 2],
      ['SELECT event_series', 1],
      ['SELECT league_memberships', 2],
      ['SELECT leagues', 1],
      ['SELECT participant_contest_scoring_rules', 1],
      ['SELECT sport_event_participant_valuations', 2],
      ['SELECT sport_event_participants', 3],
      ['SELECT sport_event_tiers', 3],
      ['SELECT sport_events', 3],
      ['SELECT sport_leagues', 2],
      ['SELECT sports', 1],
      ['SELECT users', 1],
      ['UPDATE contests', 1],
    ]);
  });
});

/**
 * A league's squares contest under way on a football game: the league's team holds the top row,
 * the numbers are drawn, and the first three quarters are scored. With `gameFinished`, the game's
 * final result is already in, as an event finished after its last game would have it.
 */
async function squaresContestUnderWay(options: { gameFinished: boolean }) {
  const prisma = getPrisma();
  const { leagueId, squadId } = await leagueWithTeam();
  const admin = await createTestUser({ isRootAdmin: true });
  const suffix = randomUUID().slice(0, 8);
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.AMERICAN_FOOTBALL },
    create: { sport: Sport.AMERICAN_FOOTBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `read-once-squares-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.AMERICAN_FOOTBALL,
      name: `Read Once Bowl ${suffix}`,
      startDate: new Date(Date.now() - 3 * 60 * 60 * 1000),
      status: 'IN_PROGRESS',
    },
  });
  const [home, away] = await Promise.all(['Home', 'Away'].map(async (side) => {
    const team = await prisma.participant.create({
      data: { sportId: sport.id, name: `Read Once ${side} ${suffix}`, participantType: 'TEAM', status: 'ACTIVE' },
    });
    return prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: team.id, isActive: true } });
  }));
  const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 1, scheduledDate: event.startDate } });
  const game = await prisma.sportEventMatch.create({
    data: {
      sportEventId: event.id,
      sportEventRoundId: round.id,
      matchNumber: 1,
      isNeutralSite: true,
      homeSportEventParticipantId: home.id,
      awaySportEventParticipantId: away.id,
      ...(options.gameFinished
        ? { status: 'COMPLETED', winnerSide: 'AWAY', homeScore: 27, awayScore: 31 }
        : { status: 'IN_PROGRESS' }),
      periodScores: {
        create: [
          { periodNumber: 1, homeScore: 7, awayScore: 0 },
          { periodNumber: 2, homeScore: 14, awayScore: 10 },
          { periodNumber: 3, homeScore: 21, awayScore: 24 },
        ],
      },
    },
  });
  const contest = await prisma.contest.create({
    data: {
      leagueId,
      seasonYear: 2026,
      sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
      squaresGame: { create: { sportEventMatchId: game.id } },
      name: `Read Once Squares ${suffix}`,
      status: 'ACTIVE',
      contestFormat: 'SQUARES',
      selectionType: 'SQUARES',
    },
  });
  const entry = await prisma.contestEntry.create({
    data: { contestId: contest.id, squadId, entryNumber: 1, name: `Read Once Entry ${suffix}`, events: { create: { sportEventId: event.id } } },
  });
  await prisma.contestEntrySquare.createMany({
    data: TIER_KEYS.map((_, columnIndex) => ({ contestId: contest.id, contestEntryId: entry.id, rowIndex: 0, columnIndex })),
  });
  await prisma.contestSquaresDraw.create({
    data: { contestId: contest.id, seed: 'read-once', rowDigits: [1, 0, 2, 3, 4, 5, 6, 7, 8, 9], columnDigits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  });
  return { admin, eventId: event.id, contestId: contest.id, gameId: game.id };
}

/**
 * How many reads of the contest's final places, best first: what its championship finishes and
 * its results email take. The standings write reads the rows it replaces too, unordered.
 */
function finalPlaceReads(statements: readonly RecordedStatement[], contestId: string): number {
  return readsWith(statements, 'contest_entry_standings', contestId).filter((statement) => statement.sql.includes('ORDER BY')).length;
}

describe('Settling a squares contest with its game (#1355)', () => {
  it('reads the bracket once, then settles the contest from the bracket it wrote, and sends a fixed set of statements when a game\'s result settles a squares contest', async () => {
    const { admin, eventId, contestId, gameId } = await squaresContestUnderWay({ gameFinished: false });

    const { response, statements } = await measureRequest({
      method: 'PUT',
      url: `/api/v1/events/${eventId}/bracket/matches/1/result`,
      headers: admin.headers,
      payload: { winnerSide: 'AWAY', homeScore: 27, awayScore: 31 },
    });

    expect(response.statusCode).toBe(200);
    expect((await getPrisma().contest.findUniqueOrThrow({ where: { id: contestId } })).status).toBe(ContestStatus.COMPLETED);
    expect([statementsOn(statements, StatementVerb.SELECT, 'sport_event_matches').length, readsWith(statements, 'sport_event_matches', gameId).length]).toEqual([1, 0]);
    expect(finalPlaceReads(statements, contestId)).toBe(1);
    expect(requestCounts(statements)).toEqual([
      ['DELETE contest_squares_winners', 1],
      ['INSERT contest_entry_event_standings', 1],
      ['INSERT contest_entry_standings', 1],
      ['INSERT contest_squares_winners', 1],
      ['INSERT league_year_finishes', 1],
      ['INSERT sport_event_participant_standings', 1],
      ['SELECT contest_draws', 1],
      ['SELECT contest_entries', 1],
      ['SELECT contest_entry_event_standings', 1],
      ['SELECT contest_entry_events', 1],
      ['SELECT contest_entry_squares', 1],
      ['SELECT contest_entry_standings', 2],
      ['SELECT contest_sport_events', 1],
      ['SELECT contest_squares_draws', 2],
      ['SELECT contest_squares_games', 1],
      ['SELECT contests', 2],
      ['SELECT event_series', 1],
      ['SELECT league_memberships', 1],
      ['SELECT leagues', 1],
      ['SELECT sport_event_match_period_scores', 1],
      ['SELECT sport_event_matches', 1],
      ['SELECT sport_event_participant_standings', 1],
      ['SELECT sport_event_rounds', 1],
      ['SELECT sport_events', 2],
      ['SELECT sport_leagues', 1],
      ['SELECT squad_memberships', 1],
      ['SELECT squads', 1],
      ['SELECT users', 1],
      ['UPDATE contests', 1],
      ['UPDATE sport_event_matches', 1],
    ]);
  });
});

describe('Finishing an event (#1355)', () => {
  it('reads each settled contest\'s final places once for both its championship finishes and its results email, and sends a fixed set of statements when an event\'s status change settles a contest', async () => {
    const { admin, eventId, contestId } = await squaresContestUnderWay({ gameFinished: true });

    const { response, statements } = await measureRequest({
      method: 'POST',
      url: `/api/v1/events/${eventId}/transition`,
      headers: admin.headers,
      payload: { toStatus: 'COMPLETED' },
    });

    expect(response.statusCode).toBe(200);
    expect((await getPrisma().contest.findUniqueOrThrow({ where: { id: contestId } })).status).toBe(ContestStatus.COMPLETED);
    expect(finalPlaceReads(statements, contestId)).toBe(1);
    expect(requestCounts(statements)).toEqual([
      ['DELETE contest_squares_winners', 1],
      ['INSERT contest_entry_event_standings', 1],
      ['INSERT contest_entry_standings', 1],
      ['INSERT contest_squares_winners', 1],
      ['INSERT league_year_finishes', 1],
      ['SELECT contest_draws', 1],
      ['SELECT contest_entries', 1],
      ['SELECT contest_entry_event_standings', 2],
      ['SELECT contest_entry_events', 1],
      ['SELECT contest_entry_squares', 1],
      ['SELECT contest_entry_standings', 2],
      ['SELECT contest_sport_events', 2],
      ['SELECT contest_squares_draws', 2],
      ['SELECT contest_squares_games', 1],
      ['SELECT contests', 1],
      ['SELECT event_series', 2],
      ['SELECT league_memberships', 1],
      ['SELECT leagues', 1],
      ['SELECT participant_league_affiliations', 1],
      ['SELECT participants', 1],
      ['SELECT sport_event_match_period_scores', 3],
      ['SELECT sport_event_matches', 3],
      ['SELECT sport_event_participant_race_results', 1],
      ['SELECT sport_event_participant_rounds', 1],
      ['SELECT sport_event_participant_standings', 1],
      ['SELECT sport_event_participant_valuations', 1],
      ['SELECT sport_event_participants', 4],
      ['SELECT sport_event_rounds', 3],
      ['SELECT sport_event_tiers', 2],
      ['SELECT sport_events', 3],
      ['SELECT sport_leagues', 2],
      ['SELECT squad_memberships', 1],
      ['SELECT squads', 1],
      ['SELECT users', 1],
      ['UPDATE contests', 1],
      ['UPDATE sport_events', 1],
    ]);
  });
});
