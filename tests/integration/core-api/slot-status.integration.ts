import { expect } from '@jest/globals';
import type { MatchStatusWrite } from '@poolmaster/shared/db';
import { randomUUID } from 'node:crypto';
import { BackgroundJobType, HomeAway, MatchStatus, ProviderSyncFindingKind, ProviderSyncFindingSeverity, ProviderSyncFindingStatus, SeasonSlotStatus, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import {
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import { PrismaSlotStatusRepository } from '../../../packages/core-api/src/adapters/prisma-slot-status-repository';
import { DomainEventType } from '../../../packages/core-api/src/modules/domain-events';
import { SlotStatusService } from '../../../packages/core-api/src/modules/events/slot-status-service';
import { testDomainEvents } from '../../support/domain-events';
import { expectDefined } from '../../support/expect-defined';
import { fixtureSeasonId } from '../../support/event-edition';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { sportPlay } from '../../support/sport-play';
import { sportRowKeys } from '../../support/sport-rows';
import { cleanupTestData, getAppPrisma, getPrisma, integrationEventLifecycle, integrationSyncFindings, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { recordStatements, statementCounts } from '../statement-log';

// Status bubbling (#2013) against real Postgres: Matches move their Season slot, and slots move
// their event through the event lifecycle, each a guarded write carrying the next refresh. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const KICKOFF = new Date('2027-01-10T18:00:00.000Z');

/** A football week of `games` single games in one slot, scheduled, its lifecycle automatic. */
async function week(games: number) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.FOOTBALL },
    create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL) },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.create({
    data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Status league ${randomUUID()}` },
  });
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    sportLeagueId: sportLeague.id,
    sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2027),
    name: 'Week 18',
    startDate: KICKOFF,
    status: 'SCHEDULED',
    autoLifecycleEnabled: true,
  });
  await createRoundRows(prisma, new PrismaSportEventRoundRepository(getAppPrisma()), event, [{ roundNumber: 1, scheduledDate: KICKOFF }]);
  const teams = await Promise.all(Array.from({ length: games * 2 }, (_, index) => prisma.participant.create({ data: { sportLeagueId: sportLeague.id, name: `Team ${index}`, participantType: 'TEAM' } })));
  const field = new PrismaSportEventParticipantRepository(getAppPrisma());
  await field.createMany(event.id, teams.map((team) => ({ participantId: team.id })));
  const rows = await field.findBySportEvent(event.id);
  const row = (index: number) => expectDefined(rows.find((each) => each.participantId === teams[index]?.id), 'field row').id;
  const matches = new PrismaSportEventRoundMatchRepository(getAppPrisma());
  const matchIds = Array.from({ length: games }, () => randomUUID());
  await matches.replaceBracket(event.id, matchIds.map((id, index) => ({
    id, roundNumber: 1, matchNumber: index + 1,
    sides: [
      { sideNumber: 1, sportEventParticipantId: row(index * 2 + 1), homeAway: HomeAway.AWAY },
      { sideNumber: 2, sportEventParticipantId: row(index * 2), homeAway: HomeAway.HOME },
    ],
    isNeutralSite: false, scheduledDate: KICKOFF, advancesToMatchId: null, advancesToSideNumber: null, regionLabel: null,
  })));
  const slot = await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id }, select: { sportLeagueSeasonCompetitionSlotId: true } });
  return { event, matchIds, seasonSlotId: slot.sportLeagueSeasonCompetitionSlotId };
}

function service() {
  return new SlotStatusService({
    slots: new PrismaSlotStatusRepository(getAppPrisma()),
    sportEvents: new PrismaSportEventRepository(getAppPrisma()),
    eventLifecycle: integrationEventLifecycle(),
    domainEvents: testDomainEvents(),
    findings: integrationSyncFindings(),
  });
}

/** Moves Matches as the feed's live statuses do, with the job the write carries. */
async function moveMatches(sportEventId: string, statuses: readonly MatchStatusWrite[]) {
  const statusChanged = await testDomainEvents().collect({ type: DomainEventType.MATCH_STATUS_CHANGED, sportEventId });
  await new PrismaSportEventRoundMatchRepository(getAppPrisma()).applyStatuses(statuses, statusChanged.jobs);
}

const seasonSlotStatus = async (id: string) => (await getPrisma().sportLeagueSeasonCompetitionSlot.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const eventStatus = async (id: string) => (await getPrisma().sportEvent.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const queuedTypes = async (sportEventId: string) => (await getPrisma().backgroundJob.findMany({ where: { sportEventId, status: 'QUEUED' }, select: { type: true } })).map((job) => job.type).sort();

describe('status bubbling from Matches to the Season slot to the event (#2013)', () => {
  it('a Match going live writes one waiting slot refresh, however many writes say so, and the refresh starts the slot with the event refresh in the same write', async () => {
    const { event, matchIds, seasonSlotId } = await week(2);

    await moveMatches(event.id, [{ id: expectDefined(matchIds[0], 'match'), status: MatchStatus.IN_PROGRESS }]);
    await moveMatches(event.id, [{ id: expectDefined(matchIds[0], 'match'), status: MatchStatus.IN_PROGRESS }]);
    expect(await queuedTypes(event.id)).toEqual([BackgroundJobType.REFRESH_SLOT_STATUS]);

    await expect(service().refreshSlots(event.id)).resolves.toEqual({ changedCount: 1 });
    expect(await seasonSlotStatus(seasonSlotId)).toBe(SeasonSlotStatus.IN_PROGRESS);
    expect(await queuedTypes(event.id)).toEqual([BackgroundJobType.ACTIVATE_EVENT_CONTESTS, BackgroundJobType.REFRESH_EVENT_STATUS, BackgroundJobType.REFRESH_SLOT_STATUS]);

    await expect(service().refreshEvent(event.id)).resolves.toEqual({ changedCount: 1 });
    expect(await eventStatus(event.id)).toBe(SportEventStatus.IN_PROGRESS);
  });

  it('completes the slot once every game is decided, then completes the event, and a refresh with nothing moved writes nothing', async () => {
    const { event, matchIds, seasonSlotId } = await week(2);
    await getPrisma().sportEventRoundMatch.updateMany({ where: { id: { in: matchIds } }, data: { status: MatchStatus.COMPLETED } });
    await getPrisma().sportEventRoundMatch.update({ where: { id: expectDefined(matchIds[1], 'match') }, data: { status: MatchStatus.CANCELLED } });

    await service().refreshSlots(event.id);
    expect(await seasonSlotStatus(seasonSlotId)).toBe(SeasonSlotStatus.COMPLETED);
    await service().refreshEvent(event.id);
    expect(await eventStatus(event.id)).toBe(SportEventStatus.COMPLETED);

    await getPrisma().backgroundJob.deleteMany({ where: { sportEventId: event.id, type: { in: [BackgroundJobType.REFRESH_EVENT_STATUS] } } });
    await expect(service().refreshSlots(event.id)).resolves.toEqual({ changedCount: 0 });
    await expect(service().refreshEvent(event.id)).resolves.toEqual({ changedCount: 0 });
    expect(await queuedTypes(event.id)).not.toContain(BackgroundJobType.REFRESH_EVENT_STATUS);
  });

  it('keeps a completed slot COMPLETED when a late feed change moves one of its games back, and raises one open late-change finding for the event however often it is refreshed', async () => {
    const { event, matchIds, seasonSlotId } = await week(2);
    await getPrisma().sportEventRoundMatch.updateMany({ where: { id: { in: matchIds } }, data: { status: MatchStatus.COMPLETED } });
    await service().refreshSlots(event.id);
    expect(await seasonSlotStatus(seasonSlotId)).toBe(SeasonSlotStatus.COMPLETED);
    const lateChangeFindings = () => getPrisma().providerSyncFinding.findMany({
      where: { kind: ProviderSyncFindingKind.SLOT_CHANGED_AFTER_COMPLETED, sportEventId: event.id },
      select: { status: true, severity: true, sportLeagueId: true },
    });
    expect(await lateChangeFindings()).toEqual([]);

    await getPrisma().sportEventRoundMatch.update({ where: { id: expectDefined(matchIds[0], 'match') }, data: { status: MatchStatus.IN_PROGRESS } });
    await expect(service().refreshSlots(event.id)).resolves.toEqual({ changedCount: 0 });
    await service().refreshSlots(event.id);

    expect(await seasonSlotStatus(seasonSlotId)).toBe(SeasonSlotStatus.COMPLETED);
    expect(await lateChangeFindings()).toEqual([{ status: ProviderSyncFindingStatus.OPEN, severity: ProviderSyncFindingSeverity.WARNING, sportLeagueId: event.sportLeagueId }]);
  });

  it('a slot write that loses its guard to another writer writes no follow-up job', async () => {
    const { event, seasonSlotId } = await week(1);

    const moved = await new PrismaSlotStatusRepository(getAppPrisma()).transitionStatus(
      seasonSlotId,
      { from: SeasonSlotStatus.IN_PROGRESS, to: SeasonSlotStatus.COMPLETED },
      [(await testDomainEvents().collect({ type: DomainEventType.SEASON_SLOT_STATUS_CHANGED, sportEventId: event.id, seasonSlotId, from: SeasonSlotStatus.IN_PROGRESS, to: SeasonSlotStatus.COMPLETED })).jobs].flat(),
    );

    expect(moved).toBe(false);
    expect(await seasonSlotStatus(seasonSlotId)).toBe(SeasonSlotStatus.SCHEDULED);
    expect(await queuedTypes(event.id)).toEqual([]);
  });

  it('reads an event\'s slots and Matches in the same statements for 2 games as for 20', async () => {
    const small = await week(2);
    const large = await week(20);

    const counted = async (sportEventId: string) => statementCounts((await recordStatements(() => service().refreshSlots(sportEventId))).statements);

    // Pinned: the event, its slots with their Season slot, and its Matches with their round; nothing written.
    expect(await counted(large.event.id)).toEqual(await counted(small.event.id));
    expect((await counted(small.event.id)).filter(([sql]) => !sql.startsWith('SELECT'))).toEqual([]);
  });
});
