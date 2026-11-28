import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { BackgroundJobType, GameSideStatus, JobTrigger, SeasonSlotStatus, Sport } from '@poolmaster/shared/domain';
import type { RaceSessionUpdate } from '@poolmaster/shared/dto';
import { PrismaProviderSyncRunRepository, PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters';
import { PrismaSlotStatusRepository } from '../../../packages/core-api/src/adapters/prisma-slot-status-repository';
import { PrismaSportLeagueSeasonRepository } from '../../../packages/core-api/src/adapters/prisma-sport-league-season-repository';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { SlotStatusService } from '../../../packages/core-api/src/modules/events/slot-status-service';
import { createRaceResultService } from '../../../packages/core-api/src/modules/events/wiring';
import { LeagueEventsSync } from '../../../packages/core-api/src/modules/events/league-events-sync';
import type { ProviderEventDetailSummary } from '../../../packages/core-api/src/modules/events/provider-season-schedule-reader';
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { testDomainEvents } from '../../support/domain-events';
import { syncLeagueTo, syncSeasonsTo, SYNCED_PROVIDER_ID } from '../../support/league-sync';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportPlay } from '../../support/sport-play';
import { sportRowKeys } from '../../support/sport-rows';
import { nameSlotDefinitionFor } from '../../support/sync-slots';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  integrationBackgroundJobs,
  integrationEventLifecycle,
  integrationSportEventServices,
  integrationSyncFindings,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

// Formula 1 from the feed (#2045) against real Postgres: a Grand Prix weekend lands on its Season
// slot with only the sessions its league plays as Rounds, and the feed's race results land on the
// race's FIELD Game with the drivers as its sides. The provider's slate and results are the one
// stand-in: the adapter's reads of BALLDONTLIE are tested on their own.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const NOW = new Date('2027-05-01T12:00:00Z');
const RACE_START = new Date('2027-05-30T13:00:00Z');

/** A racing league synced from BALLDONTLIE's Formula 1, playing `playedTypes`, with a Monaco slot matched by name. */
async function formulaOne(playedTypes: readonly string[] = ['Race']) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.AUTO_RACING },
    create: { sport: Sport.AUTO_RACING, ...sportRowKeys(Sport.AUTO_RACING) },
    update: {},
  });
  const league = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Race League ${randomUUID().slice(0, 8)}` } });
  const sportLeagueProviderMappingId = await syncLeagueTo(prisma, league.id, 'f1');
  const [seasonId] = await syncSeasonsTo(prisma, league.id, sportLeagueProviderMappingId, [2027]);
  await nameSlotDefinitionFor(prisma, { sportLeagueId: league.id, sportLeagueProviderMappingId, pattern: 'monaco grand prix', seasonIds: [seasonId] });
  await prisma.sportLeagueProviderSessionTypeMapping.createMany({
    data: playedTypes.map((providerSessionType) => ({ sportLeagueId: league.id, sportLeagueProviderMappingId, providerSessionType })),
  });
  return { league, sport };
}

/** The Monaco weekend as the feed lists it: practice, qualifying and the race, out of order. */
function monaco(sessions = [
  { providerSessionId: '5503', sessionType: 'Race', startsAt: RACE_START },
  { providerSessionId: '5501', sessionType: 'Practice', startsAt: new Date('2027-05-28T11:30:00Z') },
  { providerSessionId: '5502', sessionType: 'Qualifying', startsAt: new Date('2027-05-29T14:00:00Z') },
]): ProviderEventDetailSummary & { externalId: string } {
  return {
    externalId: 'f1-1108',
    name: 'Monaco Grand Prix',
    venue: 'Circuit de Monaco',
    startDate: new Date('2027-05-28T11:30:00Z'),
    endDate: RACE_START,
    providerSlots: [{ code: 'f1-1108', startsAt: new Date('2027-05-28T11:30:00Z'), endsAt: RACE_START }],
    sessions,
  };
}

async function runEventsSync(sportLeagueId: string, events: Array<ProviderEventDetailSummary & { externalId: string }>) {
  const prisma = getAppPrisma();
  const sync = new LeagueEventsSync({
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    seasonSchedule: { listSeasonEvents: async () => events },
    seasons: new PrismaSportLeagueSeasonRepository(prisma),
    findings: integrationSyncFindings(prisma),
    sportEvents: integrationSportEventServices(prisma).sportEvents,
    syncRuns: new PrismaProviderSyncRunRepository(prisma),
    jobs: integrationBackgroundJobs(prisma).queue,
    now: () => NOW,
  });
  await sync.run({ sportLeagueId }, { jobId: randomUUID(), attempt: 1, renewLease: async () => true, trigger: JobTrigger.SCHEDULE });
}

const eventsOf = (sportLeagueId: string) => getPrisma().sportEvent.findMany({
  where: { sportLeagueId },
  select: { id: true, name: true, roundSchedule: { select: { roundNumber: true, scheduledDate: true }, orderBy: { roundNumber: 'asc' } }, slots: { select: { id: true } } },
});

/** The drivers on the event's field, each mapped to their feed id as the field sync maps them. */
async function gridOf(sportEventId: string, sportLeagueId: string, feedIds: readonly string[]) {
  const prisma = getPrisma();
  const entries = [];
  for (const feedId of feedIds) {
    const participant = await prisma.participant.create({ data: { sportLeagueId, name: `Driver ${feedId}`, participantType: 'INDIVIDUAL' } });
    await prisma.participantProviderMapping.create({ data: { providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: feedId, participantId: participant.id, sportLeagueId } });
    entries.push(await prisma.sportEventParticipant.create({ data: { sportEventId, participantId: participant.id } }));
  }
  return entries;
}

describe('Formula 1 as the migration maps it (#2045)', () => {
  it('maps the league to BALLDONTLIE\'s schedule-only f1 league, each Grand Prix by its name, each Season by its year and only the Race played, leaving its sync for an admin to turn on', async () => {
    const prisma = getPrisma();
    const mapping = await prisma.sportLeagueProviderMapping.findFirstOrThrow({
      where: { providerLeague: { code: 'f1' }, sportLeague: { sport: { sport: Sport.AUTO_RACING } } },
      select: {
        sportLeague: { select: { selectedProviderMappingId: true } },
        providerLeague: { select: { webhookEventSet: true } },
        sessionTypes: { select: { providerSessionType: true } },
        slotMappings: { select: { matchType: true, providerValue: true } },
        seasonMappings: { select: { providerSeasonId: true }, orderBy: { providerSeasonId: 'asc' } },
      },
    });

    expect(mapping.sportLeague.selectedProviderMappingId).toBeNull();
    expect(mapping.providerLeague.webhookEventSet).toBe('NONE');
    expect(mapping.sessionTypes).toEqual([{ providerSessionType: 'Race' }]);
    expect(mapping.slotMappings).toHaveLength(25);
    expect(mapping.slotMappings).toEqual(expect.arrayContaining([{ matchType: 'NAME_PATTERN', providerValue: 'monaco grand prix' }, { matchType: 'NAME_PATTERN', providerValue: 'sao paulo grand prix' }]));
    expect(mapping.seasonMappings.map((row) => row.providerSeasonId)).toEqual(['2025', '2026', '2027']);
  });
});

describe('A Formula 1 weekend from the events sync (#2045)', () => {
  it('lands the Grand Prix on its Season slot with one Round, the race, at the race\'s start: practice and qualifying are not synced', async () => {
    const { league } = await formulaOne();

    await runEventsSync(league.id, [monaco()]);

    const [event] = await eventsOf(league.id);
    expect(event.name).toBe('Monaco Grand Prix');
    expect(event.slots).toHaveLength(1);
    expect(event.roundSchedule).toEqual([{ roundNumber: 1, scheduledDate: RACE_START }]);
  });

  it('numbers each session the league plays as a Round in the order they start, when it plays the sprint too', async () => {
    const { league } = await formulaOne(['Race', 'Sprint']);
    const sprintStart = new Date('2027-05-29T10:30:00Z');

    await runEventsSync(league.id, [monaco([{ providerSessionId: '5503', sessionType: 'Race', startsAt: RACE_START }, { providerSessionId: '5504', sessionType: 'Sprint', startsAt: sprintStart }])]);

    const [event] = await eventsOf(league.id);
    expect(event.roundSchedule).toEqual([{ roundNumber: 1, scheduledDate: sprintStart }, { roundNumber: 2, scheduledDate: RACE_START }]);
  });

  it('creates no event for a weekend with no session of a type its league plays scheduled yet', async () => {
    const { league } = await formulaOne();

    await runEventsSync(league.id, [monaco([{ providerSessionId: '5501', sessionType: 'Practice', startsAt: new Date('2027-05-28T11:30:00Z') }])]);

    expect(await eventsOf(league.id)).toEqual([]);
  });
});

describe('Formula 1 race results from the feed (#2045)', () => {
  const runner = (feedId: string, position: number | null, status: GameSideStatus = GameSideStatus.FINISHED) => ({ participantExternalId: feedId, status, position });
  const session = (overrides: Partial<RaceSessionUpdate>): RaceSessionUpdate => ({
    providerSessionId: '5503', sessionType: 'Race', startsAt: RACE_START.toISOString(), isOfficial: true, runners: [], ...overrides,
  });

  it('writes the race onto its Round\'s FIELD Game with each driver a side, reading which sessions the league plays from its mappings, and writes no practice', async () => {
    const { league } = await formulaOne();
    await runEventsSync(league.id, [monaco()]);
    const [event] = await eventsOf(league.id);
    const prisma = getPrisma();
    const [norris, leclerc, piastri] = await gridOf(event.id, league.id, ['31', '32', '33']);

    const outcome = await createRaceResultService(getAppPrisma(), testDomainEvents()).persistSessionUpdatesForSportEvent(event.id, [
      session({ providerSessionId: '5501', sessionType: 'Practice', startsAt: '2027-05-28T11:30:00.000Z', runners: [runner('33', 1), runner('31', 2)] }),
      session({ runners: [runner('31', 1), runner('32', 2), runner('33', null, GameSideStatus.DID_NOT_FINISH)] }),
    ], SYNCED_PROVIDER_ID);

    const sides = await prisma.sportEventRoundMatchGameSideResult.findMany({
      where: { game: { match: { sportEventRound: { sportEventId: event.id } } } },
      select: { status: true, position: true, side: { select: { sportEventParticipantId: true } }, game: { select: { status: true, match: { select: { sportEventRound: { select: { roundNumber: true } } } } } } },
      orderBy: { position: { sort: 'asc', nulls: 'last' } },
    });
    expect(sides.map((side) => [side.side.sportEventParticipantId, side.status, side.position, side.game.match.sportEventRound.roundNumber, side.game.status])).toEqual([
      [norris.id, GameSideStatus.FINISHED, 1, 1, 'COMPLETED'],
      [leclerc.id, GameSideStatus.FINISHED, 2, 1, 'COMPLETED'],
      [piastri.id, GameSideStatus.DID_NOT_FINISH, null, 1, 'COMPLETED'],
    ]);
    expect(outcome).toMatchObject({ updatesReturned: 5, updatesPersisted: 3, updatesSkipped: 2, unmappedExternalIds: [] });
  });

  it('queues the slot status refresh with an official race, and the refresh completes the Grand Prix\'s Season slot', async () => {
    const { league } = await formulaOne();
    await runEventsSync(league.id, [monaco()]);
    const [event] = await eventsOf(league.id);
    const prisma = getPrisma();
    await gridOf(event.id, league.id, ['31', '32']);

    await createRaceResultService(getAppPrisma(), testDomainEvents()).persistSessionUpdatesForSportEvent(event.id, [
      session({ runners: [runner('31', 1), runner('32', 2)] }),
    ], SYNCED_PROVIDER_ID);

    const queued = await prisma.backgroundJob.findMany({ where: { sportEventId: event.id, status: 'QUEUED' }, select: { type: true } });
    expect(queued.map((job) => job.type)).toContain(BackgroundJobType.REFRESH_SLOT_STATUS);
    await new SlotStatusService({
      slots: new PrismaSlotStatusRepository(getAppPrisma()),
      sportEvents: new PrismaSportEventRepository(getAppPrisma()),
      eventLifecycle: integrationEventLifecycle(),
      domainEvents: testDomainEvents(),
      findings: integrationSyncFindings(),
    }).refreshSlots(event.id);
    const slot = await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id }, select: { seasonSlot: { select: { status: true } } } });
    expect(slot.seasonSlot.status).toBe(SeasonSlotStatus.COMPLETED);
  });
});
