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
// or lost: look at which table moved before changing the pin.

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
