import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { BackgroundJobType, HomeAway, MatchStatus, ProviderSyncFindingKind, Sport } from '@poolmaster/shared/domain';
import {
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import { PrismaSlotTiebreakerRepository } from '../../../packages/core-api/src/adapters/prisma-slot-tiebreaker-repository';
import { SlotTiebreakerService } from '../../../packages/core-api/src/modules/events/slot-tiebreaker-service';
import { testDomainEvents } from '../../support/domain-events';
import { expectDefined } from '../../support/expect-defined';
import { fixtureSeasonId } from '../../support/event-edition';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { sportPlay } from '../../support/sport-play';
import { sportRowKeys } from '../../support/sport-rows';
import { cleanupTestData, getAppPrisma, getPrisma, integrationSyncFindings, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { recordStatements, statementCounts } from '../statement-log';

// An event slot's tiebreaker game (#2048) against real Postgres: the rule over a week's Games, run
// again on a schedule change until the chosen game starts, and a cancelled or moved game replaced
// with a finding. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const SUNDAY_EARLY = new Date('2027-01-10T18:00:00.000Z');
const SUNDAY_LATE = new Date('2027-01-10T21:25:00.000Z');
const MONDAY_NIGHT = new Date('2027-01-12T01:15:00.000Z');

/** A week of three games in one slot: two on Sunday and one on Monday night. */
async function week() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.FOOTBALL },
    create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL), tournamentFormat: 'MATCHES' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.create({
    data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Tiebreaker league ${randomUUID()}` },
  });
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    sportLeagueId: sportLeague.id,
    sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2027),
    name: 'Week 18',
    startDate: SUNDAY_EARLY,
    status: 'SCHEDULED',
    rounds: 1,
    autoLifecycleEnabled: false,
  });
  await createRoundRows(prisma, new PrismaSportEventRoundRepository(getAppPrisma()), event, [{ roundNumber: 1, scheduledDate: SUNDAY_EARLY }]);
  const teams = await Promise.all(['A', 'B', 'C', 'D', 'E', 'F'].map((name) => prisma.participant.create({ data: { sportLeagueId: sportLeague.id, name: `Team ${name}`, participantType: 'TEAM' } })));
  const field = new PrismaSportEventParticipantRepository(getAppPrisma());
  await field.createMany(event.id, teams.map((team) => ({ participantId: team.id })));
  const rows = await field.findBySportEvent(event.id);
  const row = (index: number) => expectDefined(rows.find((each) => each.participantId === teams[index]?.id), 'field row').id;
  const matches = new PrismaSportEventRoundMatchRepository(getAppPrisma());
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const kickoffs = [SUNDAY_EARLY, SUNDAY_LATE, MONDAY_NIGHT];
  await matches.replaceBracket(event.id, ids.map((id, index) => ({
    id, roundNumber: 1, matchNumber: index + 1,
    sides: [
      { sideNumber: 1, sportEventParticipantId: row(index * 2 + 1), homeAway: HomeAway.AWAY },
      { sideNumber: 2, sportEventParticipantId: row(index * 2), homeAway: HomeAway.HOME },
    ],
    isNeutralSite: false, scheduledDate: kickoffs[index] ?? null, advancesToMatchId: null, advancesToSideNumber: null, regionLabel: null,
  })));
  const games = await prisma.sportEventRoundMatchGame.findMany({ where: { sportEventId: event.id }, select: { id: true, sportEventRoundMatchId: true } });
  const gameOf = (index: number) => expectDefined(games.find((game) => game.sportEventRoundMatchId === ids[index]), 'game').id;
  const slot = await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id }, select: { id: true, sportLeagueSeasonCompetitionSlotId: true } });
  return { event, sportLeague, matchIds: ids, gameOf, slot, matches };
}

function rootAdmin() {
  const id = randomUUID();
  return getPrisma().user.create({ data: { email: `admin-${id}@integration.test`, username: `admin-${id}`, firstName: 'Root', lastName: 'Admin', isRootAdmin: true } });
}

function service(now: Date) {
  return new SlotTiebreakerService({
    slots: new PrismaSlotTiebreakerRepository(getAppPrisma()),
    findings: integrationSyncFindings(),
    domainEvents: testDomainEvents(),
    now: () => now,
  });
}

async function storedTiebreaker(sportEventSlotId: string): Promise<string | null> {
  return (await getPrisma().sportEventSlot.findUniqueOrThrow({ where: { id: sportEventSlotId }, select: { tiebreakerGameId: true } })).tiebreakerGameId;
}

describe('SlotTiebreakerService.refresh', () => {
  it('chooses the week\'s last kickoff, writing it with the job that rebuilds the boards and no second run of the rule', async () => {
    const { event, gameOf, slot } = await week();

    expect(await service(SUNDAY_EARLY).refresh(event.id)).toEqual({ changedCount: 1, replacedCount: 0 });

    expect(await storedTiebreaker(slot.id)).toBe(gameOf(2));
    const jobs = await getPrisma().backgroundJob.findMany({ where: { sportEventId: event.id }, select: { type: true } });
    expect(jobs.map((job) => job.type)).toEqual([BackgroundJobType.REBUILD_LEADERBOARDS]);
  });

  it('reads an event\'s slots and Games in a fixed number of statements, and changes nothing when the rule\'s game is already chosen', async () => {
    const { event } = await week();
    await service(SUNDAY_EARLY).refresh(event.id);

    const { result, statements } = await recordStatements(() => service(SUNDAY_EARLY).refresh(event.id));

    expect(result).toEqual({ changedCount: 0, replacedCount: 0 });
    // Pinned: one read of the slots and one of their Games, each with its relations (a Game's match
    // and its round); no write.
    expect(statementCounts(statements)).toEqual([
      ['SELECT sport_event_round_match_games', 1],
      ['SELECT sport_event_round_matches', 1],
      ['SELECT sport_event_rounds', 1],
      ['SELECT sport_event_slots', 1],
      ['SELECT sport_league_season_competition_slots', 1],
    ]);
  });

  it('moves to the new last kickoff when the schedule changes before the chosen game starts', async () => {
    const { event, matchIds, gameOf, slot, matches } = await week();
    await service(SUNDAY_EARLY).refresh(event.id);

    await matches.update(expectDefined(matchIds[1]), { scheduledDate: new Date('2027-01-12T03:00:00.000Z') });
    await service(SUNDAY_EARLY).refresh(event.id);

    expect(await storedTiebreaker(slot.id)).toBe(gameOf(1));
  });

  it('keeps the chosen game once it has started, whatever the schedule does next', async () => {
    const { event, matchIds, gameOf, slot, matches } = await week();
    await service(SUNDAY_EARLY).refresh(event.id);

    await matches.update(expectDefined(matchIds[1]), { scheduledDate: new Date('2027-01-12T03:00:00.000Z') });
    expect(await service(new Date('2027-01-12T01:30:00.000Z')).refresh(event.id)).toEqual({ changedCount: 0, replacedCount: 0 });

    expect(await storedTiebreaker(slot.id)).toBe(gameOf(2));
  });

  it('replaces a cancelled game by the rule\'s next choice and raises a finding, though the game had started', async () => {
    const { event, sportLeague, matchIds, gameOf, slot } = await week();
    await service(SUNDAY_EARLY).refresh(event.id);

    await getPrisma().sportEventRoundMatch.update({ where: { id: expectDefined(matchIds[2]) }, data: { status: MatchStatus.CANCELLED } });
    expect(await service(new Date('2027-01-12T02:00:00.000Z')).refresh(event.id)).toEqual({ changedCount: 1, replacedCount: 1 });

    expect(await storedTiebreaker(slot.id)).toBe(gameOf(1));
    const findings = await getPrisma().providerSyncFinding.findMany({ where: { sportEventId: event.id }, select: { kind: true, sportLeagueId: true, severity: true } });
    expect(findings).toEqual([{ kind: ProviderSyncFindingKind.TIEBREAKER_GAME_REPLACED, sportLeagueId: sportLeague.id, severity: 'WARNING' }]);
  });

  it('replaces a game a root admin chose once it is moved out of the slot, clearing the choice and leaving every entry\'s guess untouched', async () => {
    const { event, gameOf, slot } = await week();
    const tiebreakers = service(SUNDAY_EARLY);
    await tiebreakers.refresh(event.id);
    const admin = await rootAdmin();
    await tiebreakers.chooseTiebreakerGame(event.id, slot.sportLeagueSeasonCompetitionSlotId, gameOf(1), admin.id);

    // The provider moves the chosen game to another week (#2007): its Game is kept, marked moved.
    await getPrisma().sportEventRoundMatchGame.update({ where: { id: gameOf(1) }, data: { movedToGameId: gameOf(0) } });
    const { result, statements } = await recordStatements(() => tiebreakers.refresh(event.id));
    expect(result).toEqual({ changedCount: 1, replacedCount: 1 });

    const stored = await getPrisma().sportEventSlot.findUniqueOrThrow({ where: { id: slot.id }, select: { tiebreakerGameId: true, tiebreakerGameChosenAt: true, tiebreakerGameChosenByUserId: true } });
    expect(stored).toEqual({ tiebreakerGameId: gameOf(2), tiebreakerGameChosenAt: null, tiebreakerGameChosenByUserId: null });
    // A guess is stored on the entry, never tied to a Game, so it carries over: nothing touches it.
    expect(statements.filter((statement) => statement.sql.includes('contest_entr'))).toEqual([]);
  });

  it('leaves a root admin\'s choice alone on a schedule change while it has not started', async () => {
    const { event, matchIds, gameOf, slot, matches } = await week();
    const tiebreakers = service(new Date('2027-01-10T12:00:00.000Z'));
    const admin = await rootAdmin();
    await tiebreakers.chooseTiebreakerGame(event.id, slot.sportLeagueSeasonCompetitionSlotId, gameOf(0), admin.id);

    await matches.update(expectDefined(matchIds[0]), { scheduledDate: new Date('2027-01-10T19:00:00.000Z') });
    expect(await tiebreakers.refresh(event.id)).toEqual({ changedCount: 0, replacedCount: 0 });

    expect(await storedTiebreaker(slot.id)).toBe(gameOf(0));
  });
});
