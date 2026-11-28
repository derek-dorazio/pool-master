/**
 * A contest picking from the field waits for every team of the slot it starts at (#2015), against
 * Postgres: the opening reader reads whether a Season slot's teams are all known from the event's
 * games, and the lifecycle raises a finding for a draft field contest whose first slot started
 * with a team still undecided, since it can never open. No mocks.
 */
import { randomUUID } from 'node:crypto';
import {
  ContestOpening,
  ContestOpeningReason,
  ProviderSyncFindingKind,
  SeasonSlotStatus,
  SelectionType,
  Sport,
  SportEventStatus,
} from '@poolmaster/shared/domain';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { contestOpening } from '../../../packages/core-api/src/modules/contest-management/contest-opening';
import { createContestOpeningReader } from '../../../packages/core-api/src/modules/contest-management/wiring';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  integrationEventLifecycle,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { eventRoundSlots, freshEventEdition } from '../../support/event-edition';
import { createMatchRow } from '../../support/match-rows';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportPlay } from '../../support/sport-play';
import { sportRowKeys } from '../../support/sport-rows';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const DAY = 24 * 60 * 60_000;

/**
 * A released football knockout of two rounds, its field loaded: the semifinals' teams known, and
 * the final waiting for one of them. Answers each round's Season slot and a way to decide the final.
 */
async function knockout() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const startDate = new Date(Date.now() + 7 * DAY);
  // A league of its own, since a league plays one final.
  const sport = await prisma.sport.upsert({ where: { sport: Sport.FOOTBALL }, create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL) }, update: {} });
  const sportLeague = await prisma.sportLeague.create({
    data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Field Wait League ${suffix}` },
  });
  const event = await prisma.sportEvent.create({
    data: { ...(await freshEventEdition(prisma, { sport: Sport.FOOTBALL, sportLeagueId: sportLeague.id })), name: `Field Wait Playoffs ${suffix}`, startDate, status: SportEventStatus.SCHEDULED },
  });
  const slotIds = await eventRoundSlots(prisma, event.id, [{ slotKind: 'SEMIFINAL' }, { slotKind: 'FINAL' }], { isTestData: false });
  const slots = await Promise.all(slotIds.map(async (id) => {
    const { seasonSlot } = await prisma.sportEventSlot.findUniqueOrThrow({ where: { id }, select: { seasonSlot: { select: { id: true, sportLeagueCompetitionSlotId: true } } } });
    return { seasonSlotId: seasonSlot.id, slotDefinitionId: seasonSlot.sportLeagueCompetitionSlotId };
  }));
  const [semifinalStart, finalStart] = slots as [typeof slots[number], typeof slots[number]];
  const semifinalSlot = semifinalStart.seasonSlotId;
  const finalSlot = finalStart.seasonSlotId;
  const teams = await Promise.all([1, 2, 3, 4].map(async (seedNumber) => {
    const participant = await prisma.participant.create({ data: { sportLeagueId: event.sportLeagueId, name: `Seed ${String(seedNumber)} ${suffix}`, participantType: 'TEAM' } });
    return prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, seedNumber } });
  }));
  const [one, two, three, four] = teams.map((team) => team.id) as [string, string, string, string];
  const rounds = await Promise.all(slotIds.map((sportEventSlotId, index) => prisma.sportEventRound.create({
    data: { sportEventId: event.id, sportEventSlotId, roundNumber: index + 1, scheduledDate: new Date(startDate.getTime() + index * 7 * DAY) },
  })));
  const [semis, final] = rounds as [typeof rounds[number], typeof rounds[number]];
  await createMatchRow(prisma, { sportEventId: event.id, sportEventRoundId: semis.id, sportEventSlotId: semis.sportEventSlotId, matchNumber: 1, teams: [four, one], isNeutralSite: false, scheduledDate: startDate });
  await createMatchRow(prisma, { sportEventId: event.id, sportEventRoundId: semis.id, sportEventSlotId: semis.sportEventSlotId, matchNumber: 2, teams: [three, two], isNeutralSite: false, scheduledDate: startDate });
  const finalGame = await createMatchRow(prisma, { sportEventId: event.id, sportEventRoundId: final.id, sportEventSlotId: final.sportEventSlotId, matchNumber: 3, teams: [one, null], isNeutralSite: true, scheduledDate: final.scheduledDate });
  const decideFinal = () => prisma.sportEventRoundMatchSide.updateMany({ where: { sportEventRoundMatchId: finalGame.id, sportEventParticipantId: null }, data: { sportEventParticipantId: two } });
  return { event, semifinalSlot, finalSlot, semifinalStart, finalStart, decideFinal };
}

describe('createContestOpeningReader.isSlotFieldDecided against Postgres (#2015)', () => {
  it('reads a slot whose every game has both teams as decided, and one with a game still waiting for a team as not, until that team is placed', async () => {
    const { event, semifinalSlot, finalSlot, decideFinal } = await knockout();
    const reader = createContestOpeningReader(getAppPrisma());

    expect(await reader.isSlotFieldDecided(event.id, semifinalSlot)).toBe(true);
    expect(await reader.isSlotFieldDecided(event.id, finalSlot)).toBe(false);
    await decideFinal();
    expect(await reader.isSlotFieldDecided(event.id, finalSlot)).toBe(true);
  });

  it('keeps a tiered contest starting at the final waiting for its teams while a bracket and pick\'em open, and opens a tiered contest starting at the semifinals', async () => {
    const { event, semifinalStart, finalStart } = await knockout();
    const reader = createContestOpeningReader(getAppPrisma());
    const now = new Date();
    const open = (selectionType: SelectionType, startSlot: typeof finalStart) => contestOpening(reader, event.id, { selectionType, startSlot }, now);

    expect(await open(SelectionType.TIERED, finalStart)).toMatchObject({ opening: ContestOpening.NOT_YET, reason: ContestOpeningReason.FIELD_NOT_DECIDED });
    expect(await open(SelectionType.PICK_EM, finalStart)).toMatchObject({ opening: ContestOpening.OPEN, reason: null });
    expect(await open(SelectionType.BRACKET, finalStart)).not.toMatchObject({ reason: ContestOpeningReason.FIELD_NOT_DECIDED });
    expect(await open(SelectionType.TIERED, semifinalStart)).toMatchObject({ opening: ContestOpening.OPEN, reason: null });
  });
});

describe('the lifecycle\'s finding for a field contest that can never open, against Postgres (#2015)', () => {
  async function draftAtFinal(selectionType: SelectionType) {
    const prisma = getPrisma();
    const ready = await knockout();
    const season = await prisma.sportLeagueSeason.findUniqueOrThrow({ where: { id: ready.event.sportLeagueSeasonId }, select: { championshipYear: true } });
    const league = await prisma.league.create({ data: { cupName: 'Wait Cup', leagueCode: `FW${randomUUID().slice(0, 6).toUpperCase()}`, name: 'Field Wait League' } });
    await prisma.contest.create({
      data: {
        leagueId: league.id, sportLeagueSeasonId: ready.event.sportLeagueSeasonId, championshipYear: season.championshipYear,
        name: 'Final pool', status: 'DRAFT', selectionType,
        seasonSlots: { create: { sportLeagueSeasonCompetitionSlotId: ready.finalSlot } },
      },
    });
    // The final is under way: its slot started with one of its teams still undecided.
    await prisma.sportLeagueSeasonCompetitionSlot.update({ where: { id: ready.finalSlot }, data: { status: SeasonSlotStatus.IN_PROGRESS } });
    await prisma.sportEvent.update({ where: { id: ready.event.id }, data: { status: SportEventStatus.IN_PROGRESS } });
    return ready;
  }

  const findingsOf = (sportEventId: string) => getPrisma().providerSyncFinding.findMany({ where: { sportEventId, kind: ProviderSyncFindingKind.FIELD_CONTEST_CANNOT_OPEN }, select: { severity: true, status: true } });

  it('raises one open FIELD_CONTEST_CANNOT_OPEN warning for the event when a draft tiered contest\'s first slot starts with a team undecided', async () => {
    const { event } = await draftAtFinal(SelectionType.TIERED);
    const sportEvent = await new PrismaSportEventRepository(getAppPrisma()).findById(event.id);
    if (sportEvent === null) throw new Error('The event was not read back.');

    await integrationEventLifecycle().activateContestsPastCutoff(sportEvent);
    await integrationEventLifecycle().activateContestsPastCutoff(sportEvent);

    expect(await findingsOf(event.id)).toEqual([{ severity: 'WARNING', status: 'OPEN' }]);
  });

  it('raises nothing for a draft pick\'em contest on the same final, which picks sides', async () => {
    const { event } = await draftAtFinal(SelectionType.PICK_EM);
    const sportEvent = await new PrismaSportEventRepository(getAppPrisma()).findById(event.id);
    if (sportEvent === null) throw new Error('The event was not read back.');

    await integrationEventLifecycle().activateContestsPastCutoff(sportEvent);

    expect(await findingsOf(event.id)).toEqual([]);
  });
});
