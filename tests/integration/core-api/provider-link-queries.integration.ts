import { randomUUID } from 'node:crypto';
import { ProviderSyncRunStatus, Sport } from '@poolmaster/shared/domain';
import {
  PrismaProviderSyncRunRepository,
  PrismaSportEventRepository,
} from '../../../packages/core-api/src/adapters';
import {
  EventScoreSourceService,
} from '../../../packages/core-api/src/modules/events/event-score-source-service';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { freshEventEdition } from '../../support/event-edition';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';

// Sync-run history and score-source links, which only the HTTP contract tests reached before
// (#508): which runs each filter keeps and in what order, and what a link or unlink writes.

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
    const run = (
      label: string,
      overrides: { providerId?: string; sport?: Sport; status?: ProviderSyncRunStatus; createdAt: Date; startedAt: Date | null },
    ) => repo.create({
      providerId: overrides.providerId ?? 'feed-a',
      sport: overrides.sport ?? Sport.GOLF,
      eventId: label,
      status: overrides.status ?? ProviderSyncRunStatus.COMPLETED,
      startedAt: overrides.startedAt,
      completedAt: null,
      payload: {},
      createdAt: overrides.createdAt,
    });
    await run('early', { createdAt: new Date('2026-05-01T01:00:00.000Z'), startedAt: new Date('2026-05-01T01:00:00.000Z') });
    await run('late', { createdAt: new Date('2026-05-01T02:00:00.000Z'), startedAt: new Date('2026-05-01T05:00:00.000Z') });
    await run('other-feed', { providerId: 'feed-b', createdAt: new Date('2026-05-01T03:00:00.000Z'), startedAt: new Date('2026-05-01T03:00:00.000Z') });
    await run('failed', { status: ProviderSyncRunStatus.FAILED, createdAt: new Date('2026-05-01T06:00:00.000Z'), startedAt: new Date('2026-05-01T02:00:00.000Z') });
    await run('before-window', { createdAt: new Date('2026-04-30T23:59:00.000Z'), startedAt: new Date('2026-04-30T23:59:00.000Z') });
    await run('after-window', { createdAt: new Date('2026-05-02T00:01:00.000Z'), startedAt: new Date('2026-05-02T00:01:00.000Z') });
    return repo;
  }

  const eventIds = (runs: Array<{ eventId: string | null }>) => runs.map((run) => run.eventId);

  it('keeps only runs created inside the window, most recently submitted first whatever their start', async () => {
    const repo = await seedRuns();

    const runs = await repo.findAll({ createdFrom: windowStart, createdTo: windowEnd });

    expect(eventIds(runs)).toEqual(['failed', 'other-feed', 'late', 'early']);
  });

  it('narrows the window to one provider, one sport or one status', async () => {
    const repo = await seedRuns();
    const window = { createdFrom: windowStart, createdTo: windowEnd };

    expect(eventIds(await repo.findAll({ ...window, providerId: 'feed-b' }))).toEqual(['other-feed']);
    expect(eventIds(await repo.findAll({ ...window, sport: Sport.GOLF }))).toEqual(['failed', 'other-feed', 'late', 'early']);
    expect(eventIds(await repo.findAll({ ...window, status: ProviderSyncRunStatus.FAILED }))).toEqual(['failed']);
  });
});

describe('ProviderSyncRunRepository details (#1174)', () => {
  const repo = () => new PrismaProviderSyncRunRepository(getAppPrisma());
  const submitted = () => repo().create({
    providerId: 'feed-a',
    sport: Sport.GOLF,
    eventId: 'details-event',
    status: ProviderSyncRunStatus.SUBMITTED,
    startedAt: null,
    completedAt: null,
    payload: { requestedFeed: 'EVENTPARTICIPANTS' },
  });
  const details = { jobPayload: { recordsProcessed: 3 }, writeDiagnostics: { summary: { total: 3 }, rows: [] } };

  it('lists runs without their detailed diagnostics and reads one run with them', async () => {
    const run = await submitted();
    await repo().update(run.id, {
      status: ProviderSyncRunStatus.COMPLETED,
      payload: { requestedFeed: 'EVENTPARTICIPANTS', detail: 'Done.' },
      details,
    });

    const [listed] = await repo().findAll({ createdFrom: new Date(0), createdTo: new Date(Date.now() + 60_000) });
    const read = await repo().findById(run.id);

    expect(listed).toEqual(expect.objectContaining({ id: run.id, payload: { requestedFeed: 'EVENTPARTICIPANTS', detail: 'Done.' } }));
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
    await repo().update(run.id, { status: ProviderSyncRunStatus.IN_PROGRESS, payload: {}, details });

    await repo().update(run.id, { status: ProviderSyncRunStatus.COMPLETED, payload: { detail: 'Done.' } });

    expect((await repo().findById(run.id))?.details).toEqual(details);
  });
});

describe('EventScoreSourceService links', () => {
  const provider = fakeSportDataProvider({ providerId: 'integration-feed' });

  function service() {
    return new EventScoreSourceService(getAppPrisma(), registryWith(provider));
  }

  async function createEvent(name: string) {
    return createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
      ...(await freshEventEdition(getPrisma())),
      externalId: `manual-${randomUUID()}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name,
      startDate: new Date('2026-06-04T12:00:00.000Z'),
      endDate: new Date('2026-06-07T12:00:00.000Z'),
      status: 'SCHEDULED',
      rounds: 4,
      syncScope: 'NONE',
      autoLifecycleEnabled: true,
    });
  }

  it('links an event to a provider event for scores only, and unlinking returns it to a manual identity', async () => {
    const event = await createEvent('Linked Open');

    await service().linkScoreSource(event.id, { providerId: 'integration-feed', externalId: 'feed-open-2026' });
    const linked = await getPrisma().sportEvent.findUniqueOrThrow({ where: { id: event.id } });
    await service().unlinkScoreSource(event.id);
    const unlinked = await getPrisma().sportEvent.findUniqueOrThrow({ where: { id: event.id } });

    expect(linked).toEqual(expect.objectContaining({
      providerId: 'integration-feed',
      externalId: 'feed-open-2026',
      syncScope: 'SCORES_ONLY',
    }));
    expect(unlinked).toEqual(expect.objectContaining({ providerId: 'manual-admin', syncScope: 'NONE' }));
    expect(unlinked.externalId).toMatch(/^manual-/);
  });

  it('refuses a provider event another event is linked to, but relinks an event to the one it already has', async () => {
    const first = await createEvent('First Open');
    const second = await createEvent('Second Open');
    const link = { providerId: 'integration-feed', externalId: 'feed-shared-2026' };
    await service().linkScoreSource(first.id, link);

    await expect(service().linkScoreSource(second.id, link))
      .rejects.toMatchObject({ code: 'EXTERNAL_EVENT_ALREADY_LINKED', statusCode: 409 });
    await expect(service().linkScoreSource(first.id, link)).resolves.toBeUndefined();
    const unchanged = await getPrisma().sportEvent.findUniqueOrThrow({ where: { id: second.id } });
    expect(unchanged.providerId).toBe('integration-test');
  });

  it('refuses a link to a provider nobody registered, leaving the event unlinked', async () => {
    const event = await createEvent('Unregistered Feed Open');

    await expect(service().linkScoreSource(event.id, { providerId: 'no-such-feed', externalId: 'x-2026' }))
      .rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND', statusCode: 404 });
    const unchanged = await getPrisma().sportEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(unchanged).toEqual(expect.objectContaining({ providerId: 'integration-test', syncScope: 'NONE' }));
  });

  it('refuses a link to a provider that does not cover the event\'s sport, leaving the event unlinked', async () => {
    const event = await createEvent('Uncovered Open');
    // Registered by hand: a provider that covers no sport is otherwise never registered.
    const uncovering = fakeSportDataProvider({ providerId: 'uncovering-feed', sportsCovered: [] });
    const registry = new ProviderRegistry();
    registry.register(Sport.GOLF, uncovering, 'PRIMARY');

    await expect(new EventScoreSourceService(getAppPrisma(), registry).linkScoreSource(event.id, { providerId: 'uncovering-feed', externalId: 'uncovered-2026' }))
      .rejects.toMatchObject({ code: 'PROVIDER_SPORT_MISMATCH', statusCode: 422 });
    const unchanged = await getPrisma().sportEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(unchanged).toEqual(expect.objectContaining({ providerId: 'integration-test', syncScope: 'NONE' }));
  });

  it('refuses to link or unlink an event that does not exist', async () => {
    const missing = randomUUID();

    await expect(service().linkScoreSource(missing, { providerId: 'integration-feed', externalId: 'x' }))
      .rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
    await expect(service().unlinkScoreSource(missing))
      .rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('EventScoreSourceService tour reads', () => {
  const providerEvent = (externalId: string, name: string, tour: string | null) => ({
    externalId,
    providerId: 'integration-feed',
    sport: Sport.GOLF,
    name,
    startDate: new Date('2027-04-08T00:00:00.000Z'),
    status: 'SCHEDULED' as const,
    metadata: tour ? { tour } : {},
  });
  const provider = fakeSportDataProvider({
    providerId: 'integration-feed',
    getUpcomingEvents: jest.fn().mockResolvedValue([
      providerEvent('pga-1', 'Spring Classic', 'PGA Tour'),
      providerEvent('lpga-1', 'Spring Invitational', 'LPGA Tour'),
      providerEvent('none-1', 'PGA Tour Charity Day', null),
    ]),
  });

  function service() {
    return new EventScoreSourceService(getAppPrisma(), registryWith(provider));
  }

  async function createTourLeague(matchKeyword: string | null) {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    return prisma.sportLeague.create({ data: { sportId: sport.id, name: `Tour ${randomUUID()}`, matchKeyword } });
  }

  it("lists a tour's year by the stored league's keyword, matching the provider's tour exactly and ignoring case", async () => {
    const league = await createTourLeague('pga tour');

    const events = await service().listTourEventsForYear('integration-feed', league.id, 2027);

    expect(events.map((event) => event.externalId)).toEqual(['pga-1']);
  });

  it('refuses a tour read for an unknown league, and for a league with no keyword', async () => {
    const noKeyword = await createTourLeague(null);

    await expect(service().listTourEventsForYear('integration-feed', randomUUID(), 2027))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
    await expect(service().listTourEventsForYear('integration-feed', noKeyword.id, 2027))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD', statusCode: 422 });
  });

  it("narrows browsed candidates to the stored league's keyword, by tour or by name", async () => {
    const league = await createTourLeague('PGA Tour');

    const candidates = await service().listCandidateEvents('integration-feed', Sport.GOLF, { sportLeagueId: league.id });

    expect(candidates.map((event) => event.externalId)).toEqual(['pga-1', 'none-1']);
  });
});
