/**
 * #1400 — deleting a sport league or a participant costs the same SQL statements however many
 * affiliations, series and provider identities go with it, and a sport league a contest setup
 * still offers is refused. Against real Postgres, through the app; no mocks.
 */
import { randomUUID } from 'node:crypto';
import { Sport } from '@poolmaster/shared/domain';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  type TestUserResult,
  withoutJsonBodyHeaders,
} from '../helpers';
import { recordStatements } from '../statement-log';

const SMALL = 2;
const LARGE = 20;

const made = { sportLeagueIds: new Set<string>(), participantIds: new Set<string>(), templateIds: new Set<string>(), leagueIds: new Set<string>() };

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  const sportLeagueIds = [...made.sportLeagueIds];
  const participantIds = [...made.participantIds];
  await prisma.contestConfigTemplate.deleteMany({ where: { id: { in: [...made.templateIds] } } });
  await prisma.cup.deleteMany({ where: { leagueId: { in: [...made.leagueIds] } } });
  await prisma.league.deleteMany({ where: { id: { in: [...made.leagueIds] } } });
  await prisma.participantLeagueAffiliation.deleteMany({ where: { OR: [{ sportLeagueId: { in: sportLeagueIds } }, { participantId: { in: participantIds } }] } });
  await prisma.participantProviderMapping.deleteMany({ where: { participantId: { in: participantIds } } });
  await prisma.eventSeries.deleteMany({ where: { sportLeagueId: { in: sportLeagueIds } } });
  await prisma.sportLeague.deleteMany({ where: { id: { in: sportLeagueIds } } });
  await prisma.participant.deleteMany({ where: { id: { in: participantIds } } });
  await cleanupTestData();
  await teardownIntegrationTests();
});

async function golfSportId(): Promise<string> {
  const sport = await getPrisma().sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  return sport.id;
}

async function tour(sportId: string): Promise<string> {
  const row = await getPrisma().sportLeague.create({ data: { sportId, name: `Delete Scaling Tour ${randomUUID().slice(0, 8)}` } });
  made.sportLeagueIds.add(row.id);
  return row.id;
}

async function golfer(sportId: string): Promise<string> {
  const row = await getPrisma().participant.create({
    data: { sportId, name: `Delete Scaling Golfer ${randomUUID().slice(0, 8)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
  });
  made.participantIds.add(row.id);
  return row.id;
}

/** A tour with `size` affiliated golfers and `size` series that have no event. */
async function tourWithRoster(size: number): Promise<string> {
  const prisma = getPrisma();
  const sportId = await golfSportId();
  const sportLeagueId = await tour(sportId);
  for (let index = 0; index < size; index += 1) {
    await prisma.participantLeagueAffiliation.create({ data: { sportLeagueId, participantId: await golfer(sportId), ranking: index + 1 } });
    await prisma.eventSeries.create({ data: { sportLeagueId, name: `Emptied Classic ${index}` } });
  }
  return sportLeagueId;
}

/** A golfer affiliated with `size` tours and known to `size` providers. */
async function golferWithIdentities(size: number): Promise<string> {
  const prisma = getPrisma();
  const sportId = await golfSportId();
  const participantId = await golfer(sportId);
  for (let index = 0; index < size; index += 1) {
    await prisma.participantLeagueAffiliation.create({ data: { sportLeagueId: await tour(sportId), participantId } });
    await prisma.participantProviderMapping.create({
      data: { participantId, providerId: `delete-scaling-${index}`, externalId: randomUUID(), confidence: 'MANUAL' },
    });
  }
  return participantId;
}

function remove(url: string, admin: TestUserResult) {
  return getApp().inject({ method: 'DELETE', url, headers: withoutJsonBodyHeaders(admin.headers) });
}

describe('deleting a sport league or a participant costs fixed statements (#1400)', () => {
  it(`DELETE a sport league: the same 13 statements with ${SMALL} affiliations and empty series as with ${LARGE}, and every one is gone`, async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const small = await tourWithRoster(SMALL);
    const large = await tourWithRoster(LARGE);

    const smallRun = await recordStatements(() => remove(`/api/v1/sport-leagues/${small}`, admin));
    const largeRun = await recordStatements(() => remove(`/api/v1/sport-leagues/${large}`, admin));

    expect(smallRun.result.statusCode).toBe(204);
    expect(largeRun.result.statusCode).toBe(204);
    expect(largeRun.statements).toHaveLength(smallRun.statements.length);
    expect(smallRun.statements).toHaveLength(SPORT_LEAGUE_DELETE_STATEMENTS);
    const prisma = getPrisma();
    expect(await prisma.sportLeague.count({ where: { id: { in: [small, large] } } })).toBe(0);
    expect(await prisma.eventSeries.count({ where: { sportLeagueId: { in: [small, large] } } })).toBe(0);
    expect(await prisma.participantLeagueAffiliation.count({ where: { sportLeagueId: { in: [small, large] } } })).toBe(0);
  });

  it('DELETE a sport league counts its own events and cups by their sport league, never by grouping every row of those tables', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const sportLeagueId = await tourWithRoster(SMALL);

    const run = await recordStatements(() => remove(`/api/v1/sport-leagues/${sportLeagueId}`, admin));

    expect(run.result.statusCode).toBe(204);
    // Prisma's relation `_count` groups the whole child table and joins the groups back: a read of
    // every sport event in the catalog, and a plan the index check judges differently from run to run.
    const wholeTableGroups = run.statements.filter(({ sql }) => /FROM "public"\."(?:sport_events|cups)" WHERE 1=1 GROUP BY/.test(sql));
    expect(wholeTableGroups.map(({ sql }) => sql)).toEqual([]);
  });

  it(`DELETE a participant: the same 7 statements with ${SMALL} affiliations and provider identities as with ${LARGE}, and every one is gone`, async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const small = await golferWithIdentities(SMALL);
    const large = await golferWithIdentities(LARGE);

    const smallRun = await recordStatements(() => remove(`/api/v1/participants/${small}`, admin));
    const largeRun = await recordStatements(() => remove(`/api/v1/participants/${large}`, admin));

    expect(smallRun.result.statusCode).toBe(204);
    expect(largeRun.result.statusCode).toBe(204);
    expect(largeRun.statements).toHaveLength(smallRun.statements.length);
    expect(smallRun.statements).toHaveLength(PARTICIPANT_DELETE_STATEMENTS);
    const prisma = getPrisma();
    expect(await prisma.participant.count({ where: { id: { in: [small, large] } } })).toBe(0);
    expect(await prisma.participantLeagueAffiliation.count({ where: { participantId: { in: [small, large] } } })).toBe(0);
    expect(await prisma.participantProviderMapping.count({ where: { participantId: { in: [small, large] } } })).toBe(0);
  });

  it('refuses to delete a sport league a contest setup is offered for with 409 SPORT_LEAGUE_IN_USE naming the setup, and keeps it', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const sportLeagueId = await tour(await golfSportId());
    const template = await getPrisma().contestConfigTemplate.create({
      data: {
        sport: Sport.GOLF,
        sportLeagueId,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        templateKey: `delete-guard-${randomUUID()}`,
        name: 'Delete Guard Setup',
        description: 'A setup that keeps its sport league.',
        sortOrder: 1,
        configJson: {},
      },
    });
    made.templateIds.add(template.id);

    const response = await remove(`/api/v1/sport-leagues/${sportLeagueId}`, admin);

    expect(response.statusCode).toBe(409);
    const { error } = ErrorEnvelopeSchema.parse(response.json());
    expect(error.code).toBe('SPORT_LEAGUE_IN_USE');
    expect(error.message).toContain('1 contest setup');
    expect(await getPrisma().sportLeague.count({ where: { id: sportLeagueId } })).toBe(1);
  });

  it('refuses to delete a sport league a league\'s season cup is for with 409 SPORT_LEAGUE_IN_USE, and keeps the cup', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const prisma = getPrisma();
    const sportLeagueId = await tour(await golfSportId());
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const league = await prisma.league.create({ data: { name: `Cup League ${suffix}`, leagueCode: `CUPDEL${suffix}`, cupName: 'Delete Guard Cup' } });
    made.leagueIds.add(league.id);
    const cup = await prisma.cup.create({ data: { leagueId: league.id, seasonYear: 2026, sportLeagueId } });

    const response = await remove(`/api/v1/sport-leagues/${sportLeagueId}`, admin);

    expect(response.statusCode).toBe(409);
    const { error } = ErrorEnvelopeSchema.parse(response.json());
    expect(error.code).toBe('SPORT_LEAGUE_IN_USE');
    expect(error.message).toContain('1 league cup');
    // The cup's foreign key cascades, so only the refusal keeps it.
    expect(await prisma.cup.count({ where: { id: cup.id } })).toBe(1);
    expect(await prisma.sportLeague.count({ where: { id: sportLeagueId } })).toBe(1);
  });

  it('removes the deleted sport league from every league that muted it, and leaves their other muted sport leagues', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const prisma = getPrisma();
    const sportId = await golfSportId();
    const doomed = await tour(sportId);
    const kept = await tour(sportId);
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const muting = await prisma.league.create({
      data: { name: `Muting League ${suffix}`, leagueCode: `MUTEA${suffix}`, cupName: 'Muting Cup', mutedSportLeagueIds: [doomed, kept] },
    });
    const other = await prisma.league.create({
      data: { name: `Other League ${suffix}`, leagueCode: `MUTEB${suffix}`, cupName: 'Other Cup', mutedSportLeagueIds: [kept] },
    });
    made.leagueIds.add(muting.id);
    made.leagueIds.add(other.id);

    expect((await remove(`/api/v1/sport-leagues/${doomed}`, admin)).statusCode).toBe(204);

    expect((await prisma.league.findUniqueOrThrow({ where: { id: muting.id } })).mutedSportLeagueIds).toEqual([kept]);
    expect((await prisma.league.findUniqueOrThrow({ where: { id: other.id } })).mutedSportLeagueIds).toEqual([kept]);
  });
});

/**
 * Find; then one transaction: begin, lock the sport league, lock its series, its four uses (events,
 * contest setups, event page offers, cups: one count each), affiliations, series, the leagues that
 * muted it, the sport league, commit.
 */
const SPORT_LEAGUE_DELETE_STATEMENTS = 13;
/** One transaction: begin, lock the participant, count their field rows, affiliations, provider identities, the participant, commit. */
const PARTICIPANT_DELETE_STATEMENTS = 7;
