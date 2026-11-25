/**
 * The root admin's Event page reads (#1889) against a real database: the contests on an event,
 * each round's status and results, each match's completion time and the event's stored release
 * check, with the contests read pinned to a fixed number of statements.
 */
import { randomUUID } from 'crypto';
import {
  AutoReleaseCheckOutcome,
  ContestStatus,
  MatchStatus,
  ParticipantRoundStatus,
  ReleaseCheckKey,
  RoundStatus,
  SelectionType,
  SportEventStatus,
} from '@poolmaster/shared/domain';
import {
  SportEventBracketResponseSchema,
  SportEventContestListResponseSchema,
  SportEventResponseSchema,
  SportEventRoundListResponseSchema,
} from '@poolmaster/shared/dto';
import { PrismaSportEventRoundRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, createTestUser, getApp, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests, withoutJsonBodyHeaders, type TestUserResult } from '../helpers';
import { DAY, get, okBody, seedEventWithField, seedFootballWeek, seedLeagueWithTeams } from '../list-route-seeds';
import { expectConstantQueries } from '../query-scaling';
import { expectDefined } from '../../support/expect-defined';

// No mocks.

beforeAll(setupIntegrationTests);
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** The templates a case made; templates are reference data the cleanup keeps, so each case removes its own. */
const madeTemplateIds = new Set<string>();
afterEach(async () => {
  await getPrisma().contestConfigTemplate.deleteMany({ where: { id: { in: [...madeTemplateIds] } } });
  madeTemplateIds.clear();
});

/** A contest template of the event's sport league, which contests on it are set up from. */
async function templateFor(sportEventId: string) {
  const prisma = getPrisma();
  const event = await prisma.sportEvent.findUniqueOrThrow({ where: { id: sportEventId }, select: { sportLeagueId: true } });
  const template = await prisma.contestConfigTemplate.create({
    data: {
      sportLeagueId: event.sportLeagueId,
      coverageMode: 'ONE_SLOT',
      contestFormat: 'ROSTER',
      selectionType: SelectionType.TIERED,
      templateKey: `pick-6-${randomUUID().slice(0, 8)}`,
      name: 'Pick 6',
      description: 'Six golfers, one from each tier.',
      sortOrder: 1,
      configJson: {},
    },
  });
  madeTemplateIds.add(template.id);
  return template;
}

/**
 * `contests` contests on one golf event, each in a league of its own with one entry, the first
 * set up from a template and the rest without, created a minute apart so the newest is last made.
 */
async function seedEventContests(contests: number) {
  const prisma = getPrisma();
  const { event } = await seedEventWithField(2);
  const template = await templateFor(event.id);
  const made = [];
  for (let index = 0; index < contests; index += 1) {
    const { league, squads } = await seedLeagueWithTeams(1);
    const contest = await prisma.contest.create({
      data: {
        leagueId: league.id,
        seasonYear: event.startDate.getUTCFullYear(),
        name: `Event Pool ${index}`,
        status: index === 0 ? ContestStatus.OPEN : ContestStatus.DRAFT,
        contestFormat: 'ROSTER',
        selectionType: SelectionType.TIERED,
        createdAt: new Date(Date.UTC(2026, 10, 1, 12, index)),
        sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
        entries: { create: squads.map((squad) => ({ squadId: squad.id, entryNumber: 1, name: squad.name })) },
      },
    });
    if (index === 0) {
      await prisma.contestConfiguration.create({ data: { contestId: contest.id, templateId: template.id, selectionType: SelectionType.TIERED } });
    }
    made.push({ contest, league });
  }
  return { event, template, made, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

describe('GET /api/v1/events/{eventId}/contests', () => {
  it('lists every contest on the event, newest first, with its league (id, code and name), template, status and entry count', async () => {
    const { event, template, made, rootAdmin } = await seedEventContests(2);
    const [first, second] = made;

    const response = await get(`/api/v1/events/${event.id}/contests`, rootAdmin);
    const body = SportEventContestListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.contests).toEqual([
      {
        id: second.contest.id, name: 'Event Pool 1', status: ContestStatus.DRAFT, leagueId: second.league.id, leagueCode: second.league.leagueCode, leagueName: second.league.name,
        contestTemplateId: null, contestTemplateName: null, entryCount: 1, createdAt: '2026-11-01T12:01:00.000Z',
      },
      {
        id: first.contest.id, name: 'Event Pool 0', status: ContestStatus.OPEN, leagueId: first.league.id, leagueCode: first.league.leagueCode, leagueName: first.league.name,
        contestTemplateId: template.id, contestTemplateName: 'Pick 6', entryCount: 1, createdAt: '2026-11-01T12:00:00.000Z',
      },
    ]);
  });

  it('answers an empty list for an event no contest runs on', async () => {
    const { event } = await seedEventWithField(2);

    const body = okBody(await get(`/api/v1/events/${event.id}/contests`, await createTestUser({ isRootAdmin: true })), SportEventContestListResponseSchema);

    expect(body.contests).toEqual([]);
  });

  it('refuses anyone but a root admin with 403, and an unknown event with 404', async () => {
    const { event } = await seedEventWithField(2);

    const member = await get(`/api/v1/events/${event.id}/contests`, await createTestUser());
    const unknown = await get(`/api/v1/events/${randomUUID()}/contests`, await createTestUser({ isRootAdmin: true }));

    expect(member.statusCode).toBe(403);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: { code: 'EVENT_NOT_FOUND' } });
  });

  it('costs the same statements for 2 contests in 2 leagues as for 20 in 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/events/{eventId}/contests',
      seed: seedEventContests,
      call: ({ event, rootAdmin }) => get(`/api/v1/events/${event.id}/contests`, rootAdmin),
      rowsShown: (response) => {
        const { contests } = okBody(response, SportEventContestListResponseSchema);
        // Every contest's league and entry is read, so a read that skipped one would show here.
        expect(contests.every((contest) => contest.entryCount === 1 && contest.leagueName.startsWith('Scaling League'))).toBe(true);
        return contests.length;
      },
    });
  });
});

describe('an event\'s rounds read where each round stands', () => {
  it('reads a golf round as completed once every recorded participant round is finished, in progress while one is under way, and scheduled with none', async () => {
    const prisma = getPrisma();
    const { event, field } = await seedEventWithField(2, { status: SportEventStatus.IN_PROGRESS, startsInDays: -1 });
    const [first, second] = field;
    const rounds = [];
    for (let roundNumber = 1; roundNumber <= 3; roundNumber += 1) {
      rounds.push(await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber, scheduledDate: new Date(event.startDate.getTime() + (roundNumber - 1) * DAY) } }));
    }
    const [roundOne, roundTwo] = rounds;
    const finishedAt = new Date('2026-11-02T22:00:00.000Z');
    await prisma.sportEventParticipantRound.createMany({
      data: [
        { sportEventParticipantId: expectDefined(first).id, sportEventRoundId: expectDefined(roundOne).id, status: ParticipantRoundStatus.COMPLETED, completedAt: new Date('2026-11-02T20:00:00.000Z') },
        { sportEventParticipantId: expectDefined(second).id, sportEventRoundId: expectDefined(roundOne).id, status: ParticipantRoundStatus.DNF, completedAt: finishedAt },
        { sportEventParticipantId: expectDefined(first).id, sportEventRoundId: expectDefined(roundTwo).id, status: ParticipantRoundStatus.COMPLETED, completedAt: finishedAt },
        { sportEventParticipantId: expectDefined(second).id, sportEventRoundId: expectDefined(roundTwo).id, status: ParticipantRoundStatus.IN_PROGRESS },
      ],
    });

    const body = okBody(await get(`/api/v1/events/${event.id}/rounds`, await createTestUser({ isRootAdmin: true })), SportEventRoundListResponseSchema);

    expect(body.rounds.map(({ roundNumber, status, resultCount, completedAt }) => ({ roundNumber, status, resultCount, completedAt }))).toEqual([
      { roundNumber: 1, status: RoundStatus.COMPLETED, resultCount: 2, completedAt: finishedAt.toISOString() },
      { roundNumber: 2, status: RoundStatus.IN_PROGRESS, resultCount: 1, completedAt: null },
      { roundNumber: 3, status: RoundStatus.SCHEDULED, resultCount: 0, completedAt: null },
    ]);
  });

  it('groups a week\'s games by round and status, with the latest completion time of each group', async () => {
    const { event, games } = await seedFootballWeek({ games: 3, startDate: new Date('2026-11-01T18:00:00.000Z'), status: SportEventStatus.IN_PROGRESS, played: 2 });
    const completedAt = new Date('2026-11-01T21:30:00.000Z');
    await getPrisma().sportEventRoundMatch.updateMany({ where: { id: { in: games.slice(0, 2).map((game) => game.id) } }, data: { completedAt } });

    const facts = await new PrismaSportEventRoundRepository(getAppPrisma()).findResultFacts(event.id);

    const round = expectDefined([...facts.values()].at(0));
    expect(facts.size).toBe(1);
    expect(round.participantRounds).toEqual([]);
    expect([...round.matches].sort((left, right) => left.status.localeCompare(right.status))).toEqual([
      { status: MatchStatus.COMPLETED, count: 2, lastCompletedAt: completedAt },
      { status: MatchStatus.SCHEDULED, count: 1, lastCompletedAt: null },
    ]);
  });
});

function send(method: 'PUT' | 'DELETE', url: string, viewer: TestUserResult, payload?: object) {
  return getApp().inject({ method, url, ...(payload ? { headers: viewer.headers, payload } : { headers: withoutJsonBodyHeaders(viewer.headers) }) });
}

describe('a match records when its result came in', () => {
  it('sends a recorded result\'s completion time on the bracket read, and clears it when the result is cleared', async () => {
    const { event, games } = await seedFootballWeek({ games: 1, startDate: new Date(Date.now() - DAY), status: SportEventStatus.IN_PROGRESS });
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const result = { winnerSide: 'HOME', homeScore: 24, awayScore: 10 };

    const recorded = await send('PUT', `/api/v1/events/${event.id}/bracket/matches/1/result`, rootAdmin, result);
    const afterRecord = okBody(await get(`/api/v1/events/${event.id}/bracket`, rootAdmin), SportEventBracketResponseSchema).matches[0];
    const cleared = await send('DELETE', `/api/v1/events/${event.id}/bracket/matches/1/result`, rootAdmin);
    const afterClear = okBody(await get(`/api/v1/events/${event.id}/bracket`, rootAdmin), SportEventBracketResponseSchema).matches[0];

    expect([recorded.statusCode, cleared.statusCode]).toEqual([200, 200]);
    expect(afterRecord).toMatchObject({ id: games[0].id, status: MatchStatus.COMPLETED });
    expect(afterRecord.completedAt).not.toBeNull();
    expect(afterClear).toMatchObject({ status: MatchStatus.SCHEDULED, completedAt: null });
  });
});

describe('an event read carries its stored automatic release check', () => {
  it('sends the last held try with its failed checks, and null on an event never tried', async () => {
    const { event } = await seedEventWithField(2, { status: SportEventStatus.DRAFT });
    const { event: untried } = await seedEventWithField(2, { status: SportEventStatus.DRAFT });
    const checkedAt = new Date('2026-11-18T21:04:00.000Z');
    await getPrisma().sportEvent.update({
      where: { id: event.id },
      data: { autoReleaseCheckedAt: checkedAt, autoReleaseOutcome: AutoReleaseCheckOutcome.HELD, autoReleaseFailedChecks: [ReleaseCheckKey.TIERS_FILLED] },
    });
    const rootAdmin = await createTestUser({ isRootAdmin: true });

    const held = okBody(await get(`/api/v1/events/${event.id}`, rootAdmin), SportEventResponseSchema).event;
    const never = okBody(await get(`/api/v1/events/${untried.id}`, rootAdmin), SportEventResponseSchema).event;

    expect(held.lastAutoReleaseCheck).toEqual({ checkedAt: checkedAt.toISOString(), outcome: AutoReleaseCheckOutcome.HELD, failedChecks: [ReleaseCheckKey.TIERS_FILLED] });
    expect(never.lastAutoReleaseCheck).toBeNull();
  });
});
