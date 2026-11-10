import { expect, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { BackgroundJobType, ContestStatus, SelectionType, Sport } from '@poolmaster/shared/domain';
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
  drainBackgroundJobs,
  getPrisma,
  holdingBackgroundJobs,
  integrationBackgroundJobs,
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
import { PrismaContestRepository } from '../../../packages/core-api/src/adapters';
import { expectDefined } from '../../support/expect-defined';

// The routes #1355 brought under the request query budget, against Postgres: each reads the
// joiner, the team, the league and the contest's events once however many steps of the request
// need them, and sends exactly the statements pinned here. A count that moves is a read added
// or lost: look at which table moved before changing the pin. The two settling routes (a game's
// result, an event's status change) build no email in the request: each contest they start or
// complete writes its email job with the move (#1387), and the job queues the emails after.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const TIER_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * What saving a game's result sends on an event under way (#1460): the game and its standings, the
 * contests on the event a result may start, the job that settles the game's squares contests, and
 * the job that rebuilds the event's leaderboards (#1463). No contest is settled and no board is
 * rebuilt, so the count is the same however many contests the game holds.
 */
const PINNED_GAME_RESULT_COUNTS: Array<[string, number]> = [
  ['INSERT background_jobs', 2],
  ['INSERT sport_event_participant_standings', 1],
  ['SELECT contests', 1],
  ['SELECT event_series', 1],
  ['SELECT sport_event_match_period_scores', 1],
  ['SELECT sport_event_matches', 1],
  ['SELECT sport_event_participant_standings', 1],
  ['SELECT sport_event_rounds', 1],
  ['SELECT sport_events', 1],
  ['SELECT sport_leagues', 1],
  ['UPDATE sport_event_matches', 1],
];

/**
 * What an event's move to COMPLETED sends (#1448): the event and its answer, the job that settles
 * its contests, and the job that rebuilds its leaderboards (#1463). No contest or board is read or
 * written, so the count is the same however many contests the event holds.
 */
const PINNED_TRANSITION_COUNTS: Array<[string, number]> = [
  ['INSERT background_jobs', 2],
  ['SELECT contest_sport_events', 1],
  ['SELECT event_series', 2],
  ['SELECT sport_event_participants', 3],
  ['SELECT sport_event_tiers', 2],
  ['SELECT sport_events', 2],
  ['SELECT sport_leagues', 2],
  ['UPDATE sport_events', 1],
];

/**
 * The request's response and every statement it sent. The background jobs it queues are held
 * until it has returned, so their statements are not counted as its own.
 */
async function measureRequest(request: InjectOptions): Promise<{ response: LightMyRequestResponse; statements: RecordedStatement[] }> {
  const { result, statements } = await holdingBackgroundJobs(() => recordStatements(() => getApp().inject(request)));
  return { response: result, statements };
}

/** The emails queued about one contest, by template, and to whom. */
async function contestEmails(contestId: string): Promise<Array<{ templateKey: string; recipientUserId: string | null }>> {
  return getPrisma().emailMessage.findMany({
    where: { contestId },
    select: { templateKey: true, recipientUserId: true },
    orderBy: [{ templateKey: 'asc' }, { recipientUserId: 'asc' }],
  });
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
      ['SELECT league_memberships', 4], // the commissioner's own membership is kept from setting up the team (#1438)
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
      ['SELECT league_memberships', 1], // the commissioner's own membership is kept from creating the contest (#1438)
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
async function squaresContestUnderWay(options: { gameFinished: boolean; contests?: number }) {
  const prisma = getPrisma();
  const { commissioner, leagueId, squadId } = await leagueWithTeam();
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
  // Each contest is a squares pool on the same game, with one entry holding a row of boxes.
  const contestIds: string[] = [];
  for (let number = 1; number <= (options.contests ?? 1); number++) {
    const contest = await prisma.contest.create({
      data: {
        leagueId,
        seasonYear: 2026,
        sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
        squaresGame: { create: { sportEventMatchId: game.id } },
        name: `Read Once Squares ${suffix} ${number}`,
        status: 'ACTIVE',
        contestFormat: 'SQUARES',
        selectionType: 'SQUARES',
      },
    });
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId, entryNumber: 1, name: `Read Once Entry ${suffix} ${number}`, events: { create: { sportEventId: event.id } } },
    });
    await prisma.contestEntrySquare.createMany({
      data: TIER_KEYS.map((_, columnIndex) => ({ contestId: contest.id, contestEntryId: entry.id, rowIndex: 0, columnIndex })),
    });
    await prisma.contestSquaresDraw.create({
      data: { contestId: contest.id, seed: 'read-once', rowDigits: [1, 0, 2, 3, 4, 5, 6, 7, 8, 9], columnDigits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    });
    contestIds.push(contest.id);
  }
  return { admin, eventId: event.id, contestId: contestIds[0] ?? '', contestIds, gameId: game.id, commissionerId: commissioner.user.id };
}

/** Fails `contestId`'s first move to COMPLETED, as a lost connection would; restore it after. */
function failSecondContestCompletionOnce(contestId: string | undefined) {
  const transitionStatus = PrismaContestRepository.prototype.transitionStatus;
  let failed = false;
  return jest.spyOn(PrismaContestRepository.prototype, 'transitionStatus')
    .mockImplementation(async function (this: PrismaContestRepository, id, transition) {
      if (!failed && id === contestId && transition.to === ContestStatus.COMPLETED) {
        failed = true;
        throw new Error('connection lost');
      }
      return transitionStatus.call(this, id, transition);
    });
}

/** Each contest's id and status, in the order given. */
async function contestStatuses(contestIds: readonly string[]): Promise<Array<[string, string]>> {
  const rows = await getPrisma().contest.findMany({ where: { id: { in: [...contestIds] } }, select: { id: true, status: true } });
  return contestIds.map((id) => [id, rows.find((row) => row.id === id)?.status ?? 'missing']);
}

/**
 * How many reads of the contest's final places, best first: what its championship finishes and
 * its results email take. The standings write reads the rows it replaces too, unordered.
 */
function finalPlaceReads(statements: readonly RecordedStatement[], contestId: string): number {
  return readsWith(statements, 'contest_entry_standings', contestId).filter((statement) => statement.sql.includes('ORDER BY')).length;
}

describe('Settling a squares contest with its game (#1355, #1460)', () => {
  it('answers a game\'s result with a fixed set of statements that settles nothing, then settles its squares contest in the job from the bracket as it stands', async () => {
    const { admin, eventId, contestId, gameId, commissionerId } = await squaresContestUnderWay({ gameFinished: false });

    const { response, statements } = await measureRequest({
      method: 'PUT',
      url: `/api/v1/events/${eventId}/bracket/matches/1/result`,
      headers: admin.headers,
      payload: { winnerSide: 'AWAY', homeScore: 27, awayScore: 31 },
    });

    expect(response.statusCode).toBe(200);
    // The request saves the result and writes the job that settles the game's contests.
    expect((await getPrisma().contest.findUniqueOrThrow({ where: { id: contestId } })).status).toBe(ContestStatus.ACTIVE);
    expect(requestCounts(statements)).toEqual(PINNED_GAME_RESULT_COUNTS);
    await expect(getPrisma().backgroundJob.findMany({ select: { type: true, payload: true }, orderBy: { type: 'asc' } })).resolves.toEqual([
      // Ordered as the job types are declared.
      { type: 'SETTLE_GAME_CONTESTS', payload: { sportEventId: eventId, sportEventMatchId: gameId, completedAt: expect.any(String) } },
      { type: 'REBUILD_LEADERBOARDS', payload: { subject: 'EVENT', id: eventId } },
    ]);

    const { statements: jobStatements } = await recordStatements(() => drainBackgroundJobs());

    expect((await getPrisma().contest.findUniqueOrThrow({ where: { id: contestId } })).status).toBe(ContestStatus.COMPLETED);
    // The job reads the event's games once, as the result left them.
    expect(statementsOn(jobStatements, StatementVerb.SELECT, 'sport_event_matches')).toHaveLength(1);
    // Once by settlement for its championship finishes, and once by the results email job it queued.
    expect(finalPlaceReads(jobStatements, contestId)).toBe(2);
    await expect(contestEmails(contestId)).resolves.toEqual([{ templateKey: 'CONTEST_RESULTS', recipientUserId: commissionerId }]);
    // A retry of the email job queues nothing twice: each email is recorded under its idempotency key.
    await integrationBackgroundJobs().queue.enqueue(BackgroundJobType.CONTEST_SETTLED_EMAILS, { contestId });
    await drainBackgroundJobs();
    await expect(contestEmails(contestId)).resolves.toEqual([{ templateKey: 'CONTEST_RESULTS', recipientUserId: commissionerId }]);
  });

  it('sends the same statements to save a game\'s result with three squares contests on it as with one', async () => {
    const one = await squaresContestUnderWay({ gameFinished: false });
    const three = await squaresContestUnderWay({ gameFinished: false, contests: 3 });
    const result = (eventId: string, headers: InjectOptions['headers']): InjectOptions => ({
      method: 'PUT', url: `/api/v1/events/${eventId}/bracket/matches/1/result`, headers, payload: { winnerSide: 'AWAY', homeScore: 27, awayScore: 31 },
    });

    const withOne = await measureRequest(result(one.eventId, one.admin.headers));
    const withThree = await measureRequest(result(three.eventId, three.admin.headers));

    expect([withOne.response.statusCode, withThree.response.statusCode]).toEqual([200, 200]);
    expect(requestCounts(withThree.statements)).toEqual(requestCounts(withOne.statements));
    await drainBackgroundJobs();
    const statuses = await getPrisma().contest.findMany({ where: { id: { in: [...one.contestIds, ...three.contestIds] } }, select: { status: true } });
    expect(statuses.map(({ status }) => status)).toEqual(Array(4).fill(ContestStatus.COMPLETED));
  });

  it('keeps a squares contest open when its game\'s result is cleared before the job runs, and settles it with winners once the result is saved again', async () => {
    const { admin, eventId, contestId } = await squaresContestUnderWay({ gameFinished: false });
    const resultUrl = `/api/v1/events/${eventId}/bracket/matches/1/result`;
    const saveResult: InjectOptions = { method: 'PUT', url: resultUrl, headers: admin.headers, payload: { winnerSide: 'AWAY', homeScore: 27, awayScore: 31 } };

    await measureRequest(saveResult);
    const cleared = await measureRequest({ method: 'DELETE', url: resultUrl, headers: withoutJsonBodyHeaders(admin.headers) });
    expect(cleared.response.statusCode).toBe(200);
    await drainBackgroundJobs();

    // The job found the game undecided, so the contest waits for its result.
    await expect(contestStatuses([contestId])).resolves.toEqual([[contestId, ContestStatus.ACTIVE]]);
    await expect(getPrisma().contestSquaresWinner.count({ where: { contestId } })).resolves.toBe(0);

    await measureRequest(saveResult);
    await drainBackgroundJobs();

    await expect(contestStatuses([contestId])).resolves.toEqual([[contestId, ContestStatus.COMPLETED]]);
    await expect(getPrisma().contestSquaresWinner.count({ where: { contestId } })).resolves.toBeGreaterThan(0);
  });

  it('leaves no squares contest half settled when the game\'s job fails part way: the retry completes the rest once', async () => {
    const { admin, eventId, contestIds } = await squaresContestUnderWay({ gameFinished: false, contests: 2 });
    const [first, second] = contestIds;
    const failing = failSecondContestCompletionOnce(second);

    try {
      await measureRequest({ method: 'PUT', url: `/api/v1/events/${eventId}/bracket/matches/1/result`, headers: admin.headers, payload: { winnerSide: 'AWAY', homeScore: 27, awayScore: 31 } });
      await drainBackgroundJobs();

      await expect(getPrisma().backgroundJob.findFirst({ where: { type: 'SETTLE_GAME_CONTESTS' }, select: { status: true, attempts: true, lastError: true } }))
        .resolves.toEqual({ status: 'QUEUED', attempts: 1, lastError: expect.stringContaining('connection lost') });
      await expect(contestStatuses(contestIds)).resolves.toEqual([[first, ContestStatus.COMPLETED], [second, ContestStatus.ACTIVE]]);

      // The retry, made due now rather than after its backoff.
      await getPrisma().backgroundJob.updateMany({ where: { type: 'SETTLE_GAME_CONTESTS' }, data: { runAt: new Date() } });
      await drainBackgroundJobs();

      await expect(contestStatuses(contestIds)).resolves.toEqual([[first, ContestStatus.COMPLETED], [second, ContestStatus.COMPLETED]]);
      const winners = await getPrisma().contestSquaresWinner.groupBy({ by: ['contestId'], where: { contestId: { in: contestIds } }, _count: true, orderBy: { contestId: 'asc' } });
      expect(winners).toHaveLength(2);
      const emailJobs = await getPrisma().backgroundJob.findMany({ where: { type: 'CONTEST_SETTLED_EMAILS' }, select: { payload: true } });
      expect(emailJobs.map(({ payload }) => (payload as { contestId: string }).contestId).sort()).toEqual([...contestIds].sort());
    } finally {
      failing.mockRestore();
    }
  });
});

describe('Finishing an event (#1355, #1448)', () => {
  it('answers an event\'s status change with a fixed set of statements that settles nothing, then settles its contest in the job, reading its final places once for its championship finishes and once for its results email', async () => {
    const { admin, eventId, contestId, commissionerId } = await squaresContestUnderWay({ gameFinished: true });

    const { response, statements } = await measureRequest({
      method: 'POST',
      url: `/api/v1/events/${eventId}/transition`,
      headers: admin.headers,
      payload: { toStatus: 'COMPLETED' },
    });

    expect(response.statusCode).toBe(200);
    // The request only moves the event and writes the job that settles it.
    expect((await getPrisma().contest.findUniqueOrThrow({ where: { id: contestId } })).status).toBe(ContestStatus.ACTIVE);
    expect(requestCounts(statements)).toEqual(PINNED_TRANSITION_COUNTS);
    await expect(getPrisma().backgroundJob.findMany({ select: { type: true, payload: true }, orderBy: { type: 'asc' } })).resolves.toEqual([
      // Ordered as the job types are declared.
      { type: 'SETTLE_SPORT_EVENT_CONTESTS', payload: { sportEventId: eventId, completedAt: expect.any(String) } },
      { type: 'REBUILD_LEADERBOARDS', payload: { subject: 'EVENT', id: eventId } },
    ]);

    const { statements: jobStatements } = await recordStatements(() => drainBackgroundJobs());

    expect((await getPrisma().contest.findUniqueOrThrow({ where: { id: contestId } })).status).toBe(ContestStatus.COMPLETED);
    // Once by settlement for its championship finishes, and once by the results email job it queued.
    expect(finalPlaceReads(jobStatements, contestId)).toBe(2);
    // The settle job's contest wrote its final results email job, which queued the email, and the
    // settlement asked for one more rebuild of the event's boards after the status change's own.
    await expect(getPrisma().backgroundJob.findMany({ select: { type: true, status: true }, orderBy: { type: 'asc' } })).resolves.toEqual([
      { type: 'CONTEST_SETTLED_EMAILS', status: 'SUCCEEDED' },
      { type: 'SETTLE_SPORT_EVENT_CONTESTS', status: 'SUCCEEDED' },
      { type: 'REBUILD_LEADERBOARDS', status: 'SUCCEEDED' },
      { type: 'REBUILD_LEADERBOARDS', status: 'SUCCEEDED' },
    ]);
    await expect(contestEmails(contestId)).resolves.toEqual([{ templateKey: 'CONTEST_RESULTS', recipientUserId: commissionerId }]);
  });

  it('sends the same statements to finish an event with three contests as with one, as their settling is the job\'s', async () => {
    const one = await squaresContestUnderWay({ gameFinished: true });
    const three = await squaresContestUnderWay({ gameFinished: true, contests: 3 });

    const [withOne, withThree] = [
      await measureRequest({ method: 'POST', url: `/api/v1/events/${one.eventId}/transition`, headers: one.admin.headers, payload: { toStatus: 'COMPLETED' } }),
      await measureRequest({ method: 'POST', url: `/api/v1/events/${three.eventId}/transition`, headers: three.admin.headers, payload: { toStatus: 'COMPLETED' } }),
    ];

    expect([withOne.response.statusCode, withThree.response.statusCode]).toEqual([200, 200]);
    expect(requestCounts(withThree.statements)).toEqual(requestCounts(withOne.statements));
    await drainBackgroundJobs();
    const statuses = await getPrisma().contest.findMany({ where: { id: { in: [...one.contestIds, ...three.contestIds] } }, select: { status: true } });
    expect(statuses.map(({ status }) => status)).toEqual(Array(4).fill(ContestStatus.COMPLETED));
  });

  it('leaves no contest half settled when the settle job fails part way: the retry completes the rest once, and the one already completed keeps its result', async () => {
    const { admin, eventId, contestIds } = await squaresContestUnderWay({ gameFinished: true, contests: 2 });
    const [first, second] = contestIds;
    const failing = failSecondContestCompletionOnce(second);
    const settled = () => getPrisma().contest.findMany({
      where: { id: { in: contestIds } },
      select: { id: true, status: true, endsAt: true },
      orderBy: { name: 'asc' },
    });

    try {
      await measureRequest({ method: 'POST', url: `/api/v1/events/${eventId}/transition`, headers: admin.headers, payload: { toStatus: 'COMPLETED' } });
      await drainBackgroundJobs();

      const [afterFailure] = await getPrisma().backgroundJob.findMany({ where: { type: 'SETTLE_SPORT_EVENT_CONTESTS' }, select: { status: true, attempts: true, lastError: true } });
      expect(afterFailure).toEqual({ status: 'QUEUED', attempts: 1, lastError: expect.stringContaining('connection lost') });
      const [firstSettled, secondUnsettled] = await settled();
      expect([firstSettled.status, secondUnsettled.status]).toEqual([ContestStatus.COMPLETED, ContestStatus.ACTIVE]);

      // The retry, made due now rather than after its backoff.
      await getPrisma().backgroundJob.updateMany({ where: { type: 'SETTLE_SPORT_EVENT_CONTESTS' }, data: { runAt: new Date() } });
      await drainBackgroundJobs();

      await expect(settled()).resolves.toEqual([
        { id: first, status: ContestStatus.COMPLETED, endsAt: firstSettled.endsAt },
        { id: second, status: ContestStatus.COMPLETED, endsAt: firstSettled.endsAt },
      ]);
      // Each contest has its one entry's standing, and was completed (and told of its results) once.
      const standings = await getPrisma().contestEntryStanding.groupBy({ by: ['contestId'], where: { contestId: { in: contestIds } }, _count: true, orderBy: { contestId: 'asc' } });
      expect(standings.map(({ _count }) => _count)).toEqual([1, 1]);
      const emailJobs = await getPrisma().backgroundJob.findMany({ where: { type: 'CONTEST_SETTLED_EMAILS' }, select: { payload: true } });
      expect(emailJobs.map(({ payload }) => (payload as { contestId: string }).contestId).sort()).toEqual([...contestIds].sort());
      await expect(getPrisma().backgroundJob.findFirst({ where: { type: 'SETTLE_SPORT_EVENT_CONTESTS' }, select: { status: true, attempts: true } }))
        .resolves.toEqual({ status: 'SUCCEEDED', attempts: 2 });
    } finally {
      failing.mockRestore();
    }
  });
});

/**
 * A released event a week out, with OPEN contests on it: one in the first league, and with
 * `contests: 3`, two there and one in a second league.
 */
async function openContestsOnScheduledEvent(options: { contests: 1 | 3 }) {
  const prisma = getPrisma();
  const admin = await createTestUser({ isRootAdmin: true });
  const suffix = randomUUID().slice(0, 8);
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `read-once-changed-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.AMERICAN_FOOTBALL,
      name: `Read Once Changed ${suffix}`,
      startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'SCHEDULED',
    },
  });
  const leagues = options.contests === 1 ? [await leagueWithTeam()] : [await leagueWithTeam(), await leagueWithTeam()];
  const contestIds: string[] = [];
  for (let number = 1; number <= options.contests; number++) {
    const { leagueId } = expectDefined(leagues[number === 3 ? 1 : 0]);
    const contest = await prisma.contest.create({
      data: {
        leagueId,
        seasonYear: 2026,
        sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
        name: `Read Once Changed ${suffix} ${number}`,
        status: 'OPEN',
        contestFormat: 'PREDICTION',
        selectionType: SelectionType.PICK_EM,
        openedAt: new Date(),
      },
    });
    contestIds.push(contest.id);
  }
  return { admin, eventId: event.id, startDate: event.startDate, contestIds, commissionerIds: leagues.map(({ commissioner }) => commissioner.user.id) };
}

/** An admin's postponement of the event, or a move of its start by a day. */
type EventChangeRequest = (seeded: Awaited<ReturnType<typeof openContestsOnScheduledEvent>>) => InjectOptions;
const postpone: EventChangeRequest = ({ admin, eventId }) => ({
  method: 'POST',
  url: `/api/v1/events/${eventId}/transition`,
  headers: admin.headers,
  payload: { toStatus: 'POSTPONED' },
});
const moveByADay: EventChangeRequest = ({ admin, eventId, startDate }) => ({
  method: 'PATCH',
  url: `/api/v1/events/${eventId}`,
  headers: admin.headers,
  payload: { startDate: new Date(startDate.getTime() + 24 * 60 * 60 * 1000).toISOString() },
});

/**
 * What an admin's postponement sends (#1458): the event and its answer, then one read of the
 * contests told and one insert of their email jobs, beside the insert of the event's leaderboard
 * rebuild job. No league, member or entry is read, so the count is the same however many
 * contests, in however many leagues, the event holds.
 */
const PINNED_POSTPONE_COUNTS: Array<[string, number]> = [
  ['INSERT background_jobs', 2],
  ['SELECT contest_draws', 1],
  ['SELECT contest_sport_events', 2],
  ['SELECT contest_squares_draws', 1],
  ['SELECT contest_squares_games', 1],
  ['SELECT contests', 1],
  ['SELECT event_series', 2],
  ['SELECT sport_event_participants', 3],
  ['SELECT sport_event_tiers', 2],
  ['SELECT sport_events', 3],
  ['SELECT sport_leagues', 2],
  ['UPDATE sport_events', 1],
];

/**
 * What an admin's move of a released event's start sends (#1458), on the same terms. It also
 * shifts the event's rounds and rechecks its contests' entry reminders, in one write for all.
 */
const PINNED_MOVE_COUNTS: Array<[string, number]> = [
  ['INSERT background_jobs', 2],
  ['SELECT contest_draws', 1],
  ['SELECT contest_sport_events', 2],
  ['SELECT contest_squares_draws', 1],
  ['SELECT contest_squares_games', 1],
  ['SELECT contests', 1],
  ['SELECT event_series', 3],
  ['SELECT sport_event_participants', 3],
  ['SELECT sport_event_rounds', 1],
  ['SELECT sport_event_tiers', 2],
  ['SELECT sport_events', 4],
  ['SELECT sport_leagues', 3],
  ['UPDATE contests', 1],
  ['UPDATE sport_events', 1],
];

/**
 * Fails every insert of an "event changed" email job while `work` runs, as a database error
 * between the event's change and its jobs would: a check constraint added for the test and
 * dropped after it.
 */
async function withEventChangedJobsFailing<T>(work: () => Promise<T>): Promise<T> {
  await getPrisma().$executeRawUnsafe(
    `ALTER TABLE background_jobs ADD CONSTRAINT test_no_event_changed_jobs CHECK (type <> 'CONTEST_EVENT_CHANGED_EMAILS') NOT VALID`,
  );
  try {
    return await work();
  } finally {
    await getPrisma().$executeRawUnsafe('ALTER TABLE background_jobs DROP CONSTRAINT test_no_event_changed_jobs');
  }
}

describe('Postponing or moving an event whose email jobs cannot be written (#1464)', () => {
  it('leaves the event SCHEDULED, and answers with an error, when its postponement\'s email jobs fail to write, so nobody is left untold', async () => {
    const seeded = await openContestsOnScheduledEvent({ contests: 1 });

    const response = await withEventChangedJobsFailing(() => getApp().inject(postpone(seeded)));

    expect(response.statusCode).toBe(500);
    await expect(getPrisma().sportEvent.findUniqueOrThrow({ where: { id: seeded.eventId }, select: { status: true } }))
      .resolves.toEqual({ status: 'SCHEDULED' });
  });

  it('leaves the event\'s start where it was, and answers with an error, when its move\'s email jobs fail to write, so nobody is left untold', async () => {
    const seeded = await openContestsOnScheduledEvent({ contests: 1 });

    const response = await withEventChangedJobsFailing(() => getApp().inject(moveByADay(seeded)));

    expect(response.statusCode).toBe(500);
    await expect(getPrisma().sportEvent.findUniqueOrThrow({ where: { id: seeded.eventId }, select: { startDate: true } }))
      .resolves.toEqual({ startDate: seeded.startDate });
  });
});

describe('Postponing or moving an event (#1458)', () => {
  it.each([
    ['postpone', postpone, PINNED_POSTPONE_COUNTS],
    ['move', moveByADay, PINNED_MOVE_COUNTS],
  ] as const)('answers an admin\'s %s with a fixed set of statements that builds no email, writing one email job per contest for the job runner', async (_change, request, pinned) => {
    const seeded = await openContestsOnScheduledEvent({ contests: 3 });

    const { response, statements } = await measureRequest(request(seeded));

    expect(response.statusCode).toBe(200);
    expect(requestCounts(statements)).toEqual(pinned);
    const jobs = await getPrisma().backgroundJob.findMany({ where: { type: 'CONTEST_EVENT_CHANGED_EMAILS' }, select: { payload: true } });
    expect(jobs).toHaveLength(3);
    expect(jobs.map(({ payload }) => (payload as { contestId: string }).contestId).sort()).toEqual([...seeded.contestIds].sort());

    await drainBackgroundJobs();

    // Each contest's job tells that contest's own league: its commissioner, once per contest.
    for (const [index, contestId] of seeded.contestIds.entries()) {
      await expect(contestEmails(contestId)).resolves.toEqual([
        { templateKey: 'CONTEST_EVENT_CHANGED', recipientUserId: seeded.commissionerIds[index === 2 ? 1 : 0] },
      ]);
    }
  });

  it.each([
    ['postpone', postpone],
    ['move', moveByADay],
  ] as const)('sends the same statements to %s an event with three contests across two leagues as with one', async (_change, request) => {
    const one = await openContestsOnScheduledEvent({ contests: 1 });
    const three = await openContestsOnScheduledEvent({ contests: 3 });

    const withOne = await measureRequest(request(one));
    const withThree = await measureRequest(request(three));

    expect([withOne.response.statusCode, withThree.response.statusCode]).toEqual([200, 200]);
    expect(requestCounts(withThree.statements)).toEqual(requestCounts(withOne.statements));
  });
});
