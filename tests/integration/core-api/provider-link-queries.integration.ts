import { randomUUID } from 'node:crypto';
import { syncRunOutcome } from '../../support/sync-run-payload';
import { SCHEDULED_SCORES_RUN } from '../../support/sync-run-fixtures';
import { ProviderCode, ProviderSyncRunStatus, Sport } from '@poolmaster/shared/domain';
import {
  PrismaProviderSyncRunRepository,
  PrismaSportEventRepository,
} from '../../../packages/core-api/src/adapters';
import {
  ProviderSeasonScheduleReader,
} from '../../../packages/core-api/src/modules/events/provider-season-schedule-reader';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { fixtureTourId, freshEventEdition, mapEventToProvider } from '../../support/event-edition';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { SYNCED_PROVIDER_ID, syncLeagueTo } from '../../support/league-sync';
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { sportRowKeys } from '../../support/sport-rows';
import { sportPlay } from '../../support/sport-play';

// Sync-run history, which only the HTTP contract tests reached before (#508): which runs each
// filter keeps and in what order; and the provider Season schedule the events sync reads.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

describe('ProviderSyncRunRepository.findAll', () => {
  const windowStart = new Date('2026-05-01T00:00:00.000Z');
  const windowEnd = new Date('2026-05-02T00:00:00.000Z');

  async function seedRuns() {
    const repo = new PrismaProviderSyncRunRepository(getAppPrisma());
    // A run's sport is its sport league's (#2042): each run names a fixture league of its sport.
    const run = async (
      label: string,
      overrides: { sport?: Sport; status?: ProviderSyncRunStatus; createdAt: Date; startedAt: Date | null },
    ) => repo.create({
      ...SCHEDULED_SCORES_RUN,
      sportLeagueId: await fixtureTourId(getPrisma(), overrides.sport ?? Sport.GOLF),
      providerCode: ProviderCode.BALLDONTLIE,
      status: overrides.status ?? ProviderSyncRunStatus.COMPLETED,
      startedAt: overrides.startedAt,
      completedAt: null,
      ...syncRunOutcome({ summary: label }),
      createdAt: overrides.createdAt,
    });
    await run('early', { createdAt: new Date('2026-05-01T01:00:00.000Z'), startedAt: new Date('2026-05-01T01:00:00.000Z') });
    await run('late', { createdAt: new Date('2026-05-01T02:00:00.000Z'), startedAt: new Date('2026-05-01T05:00:00.000Z') });
    await run('other-sport', { sport: Sport.TENNIS, createdAt: new Date('2026-05-01T03:00:00.000Z'), startedAt: new Date('2026-05-01T03:00:00.000Z') });
    await run('failed', { status: ProviderSyncRunStatus.FAILED, createdAt: new Date('2026-05-01T06:00:00.000Z'), startedAt: new Date('2026-05-01T02:00:00.000Z') });
    await run('before-window', { createdAt: new Date('2026-04-30T23:59:00.000Z'), startedAt: new Date('2026-04-30T23:59:00.000Z') });
    await run('after-window', { createdAt: new Date('2026-05-02T00:01:00.000Z'), startedAt: new Date('2026-05-02T00:01:00.000Z') });
    return repo;
  }

  const labels = (runs: Array<{ summary: string }>) => runs.map((run) => run.summary);

  it('keeps only runs created inside the window, most recently submitted first whatever their start', async () => {
    const repo = await seedRuns();

    const runs = await repo.findAll({ createdFrom: windowStart, createdTo: windowEnd });

    expect(labels(runs)).toEqual(['failed', 'other-sport', 'late', 'early']);
  });

  it('narrows the window to one provider, one sport or one status', async () => {
    const repo = await seedRuns();
    const window = { createdFrom: windowStart, createdTo: windowEnd };

    expect(labels(await repo.findAll({ ...window, providerId: BALLDONTLIE_TEST_PROVIDER_ID }))).toEqual(['failed', 'other-sport', 'late', 'early']);
    expect(labels(await repo.findAll({ ...window, providerId: randomUUID() }))).toEqual([]);
    expect(labels(await repo.findAll({ ...window, sport: Sport.GOLF }))).toEqual(['failed', 'late', 'early']);
    expect(labels(await repo.findAll({ ...window, status: ProviderSyncRunStatus.FAILED }))).toEqual(['failed']);
  });

  it('names each run\'s Provider row, and reads its event id from the sport event it is linked to', async () => {
    const repo = new PrismaProviderSyncRunRepository(getAppPrisma());
    const externalId = `feed-event-${randomUUID().slice(0, 8)}`;
    const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
      ...(await freshEventEdition(getPrisma())),
      name: `Run Event ${randomUUID().slice(0, 8)}`,
      startDate: new Date('2026-06-04T12:00:00.000Z'),
      endDate: new Date('2026-06-07T12:00:00.000Z'),
      status: 'SCHEDULED',
      rounds: 4,
      autoLifecycleEnabled: true,
    });
    await mapEventToProvider(getPrisma(), event.id, { providerId: SYNCED_PROVIDER_ID, externalId });
    const linked = await repo.create({
      ...SCHEDULED_SCORES_RUN, sportEventId: event.id, providerCode: ProviderCode.BALLDONTLIE, 
      status: ProviderSyncRunStatus.COMPLETED, startedAt: null, completedAt: null, ...syncRunOutcome(),
    });
    const unlinked = await repo.create({
      ...SCHEDULED_SCORES_RUN, providerCode: ProviderCode.BALLDONTLIE, 
      status: ProviderSyncRunStatus.COMPLETED, startedAt: null, completedAt: null, ...syncRunOutcome(),
    });

    expect(linked).toMatchObject({ providerId: BALLDONTLIE_TEST_PROVIDER_ID, providerName: 'BALLDONTLIE', sportEventId: event.id, eventId: externalId });
    expect(unlinked).toMatchObject({ providerId: BALLDONTLIE_TEST_PROVIDER_ID, providerName: 'BALLDONTLIE', sportEventId: null, eventId: null });
    await expect(repo.findById(linked.id)).resolves.toMatchObject({ providerName: 'BALLDONTLIE', eventId: externalId });
  });
});

describe('ProviderSyncRunRepository details (#1174)', () => {
  const repo = () => new PrismaProviderSyncRunRepository(getAppPrisma());
  const submitted = () => repo().create({
    ...SCHEDULED_SCORES_RUN,
    providerCode: ProviderCode.BALLDONTLIE,
    status: ProviderSyncRunStatus.SUBMITTED,
    startedAt: null,
    completedAt: null,
    ...syncRunOutcome(),
  });
  const details = { jobPayload: { recordsProcessed: 3 }, writeDiagnostics: { summary: { total: 3 }, rows: [] } };

  it('lists runs with their outcome columns and without their detailed diagnostics, and reads one run with them', async () => {
    const run = await submitted();
    await repo().update(run.id, {
      status: ProviderSyncRunStatus.COMPLETED,
      summary: 'Done.',
      stats: { participantsReturned: 3 },
      changedCount: 2,
      errorCount: 0,
      details,
    });

    const [listed] = await repo().findAll({ createdFrom: new Date(0), createdTo: new Date(Date.now() + 60_000) });
    const read = await repo().findById(run.id);

    expect(listed).toEqual(expect.objectContaining({ id: run.id, summary: 'Done.', stats: { participantsReturned: 3 }, changedCount: 2, errorCount: 0 }));
    expect(listed).not.toHaveProperty('details');
    expect(read).toEqual(expect.objectContaining({ id: run.id, status: ProviderSyncRunStatus.COMPLETED, details }));
  });

  it('reads null details for a run that has none stored, and null for a run that does not exist', async () => {
    const run = await submitted();

    expect((await repo().findById(run.id))?.details).toBeNull();
    expect(await repo().findById(randomUUID())).toBeNull();
  });

  it('keeps the stored details when an update leaves them out', async () => {
    const run = await submitted();
    await repo().update(run.id, { status: ProviderSyncRunStatus.IN_PROGRESS, ...syncRunOutcome(), details });

    await repo().update(run.id, { status: ProviderSyncRunStatus.COMPLETED, ...syncRunOutcome({ summary: 'Done.', changedCount: 0 }) });

    expect((await repo().findById(run.id))?.details).toEqual(details);
  });
});

describe('ProviderSeasonScheduleReader tour reads', () => {
  // Synced leagues read their provider league through their selected mapping, which only a
  // provider with a row can have (#1997): the feed stands in for BALLDONTLIE here.
  const providerEvent = (externalId: string, name: string, providerLeagueCode: string | null) => ({
    externalId,
    providerId: SYNCED_PROVIDER_ID,
    sport: Sport.GOLF,
    name,
    startDate: new Date('2027-04-08T00:00:00.000Z'),
    status: 'SCHEDULED' as const,
    ...(providerLeagueCode !== null && { providerLeagueCode }),
  });
  const getUpcomingEvents = jest.fn().mockResolvedValue([
    providerEvent('pga-1', 'Spring Classic', 'pga'),
    providerEvent('lpga-1', 'Spring Invitational', 'lpga'),
    providerEvent('none-1', 'PGA Tour Charity Day', null),
  ]);
  const provider = fakeSportDataProvider({ providerId: SYNCED_PROVIDER_ID, getUpcomingEvents });

  function service() {
    return new ProviderSeasonScheduleReader(getAppPrisma(), registryWith(provider));
  }

  async function createTourLeague(providerLeagueCode: string | null) {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF) },
      update: {},
    });
    const league = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Tour ${randomUUID()}` } });
    if (providerLeagueCode !== null) await syncLeagueTo(prisma, league.id, providerLeagueCode);
    return league;
  }

  it('lists a league\'s Season from its selected provider league alone, asked for by the provider\'s Season id and filtered by the code the provider stamps on each event', async () => {
    const league = await createTourLeague('pga');

    const events = await service().listSeasonEvents(league.id, '2027');

    expect(events.map((event) => event.externalId)).toEqual(['pga-1']);
    expect(getUpcomingEvents).toHaveBeenLastCalledWith(Sport.GOLF, undefined, { providerLeagueCode: 'pga', providerSeasonId: '2027' });
  });

  it('refuses a Season read for an unknown league, and for a league with no selected provider league', async () => {
    const unsynced = await createTourLeague(null);

    await expect(service().listSeasonEvents(randomUUID(), '2027'))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
    await expect(service().listSeasonEvents(unsynced.id, '2027'))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_SYNCED', statusCode: 422 });
  });
});
