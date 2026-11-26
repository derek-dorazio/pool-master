/**
 * #2003, #2010 — every SportEvent is one sport league's, in one Season of that league (a composite
 * key). A test that writes an event row directly needs both, and usually does not care about
 * either: `freshEventEdition` gives the shared fixture tour (or the league named) and its Season.
 *
 * The fixture tour hangs off a real sport row (GOLF unless the test names another) because the
 * sport list validates names against the Sport enum; a made-up sport row would break any contract
 * test that lists sports. Each sport has its own fixture tour, playing as that sport's leagues are
 * seeded, since an event is scored by its league's family (#2001), and an event reads its sport
 * through its Season's league (#2042, #2004): a test about another sport's event names that sport.
 */
import { randomInt } from 'node:crypto';
import type { Prisma, PrismaClient, PrismaSlotKind, PrismaSlotPairing } from '@prisma/client';
import { getDefaultTournamentFormatForSport, requireProviderCodeOfSourceId, Sport } from '@poolmaster/shared/domain';
import { competitionFor, seasonCompetitionFor } from './competitions';
import { sportLeagueRowDefaults } from './league-profiles';
import { sportPlay } from './sport-play';
import { sportRowKeys } from './sport-rows';

export const FIXTURE_TOUR_NAME = 'Fixture Tour (plans/147 test editions)';

const LINKED_EVENT_ROUNDS = 4;
/** The key prefix of the slot definition a linked provider event is played in, one made per event. */
const LINKED_EVENT_SLOT_KEY = 'LINKED_EVENT';
let linkedEventCount = 0;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Db = Pick<PrismaClient, 'sport' | 'sportLeague' | 'sportLeaguePhase' | 'sportLeagueCompetition' | 'sportLeagueCompetitionSlot' | 'sportLeagueSeason' | 'platformTierProfile' | 'platformPricingProfile'>;

/** What an event row needs to be one league's (#2010): spread it into `sportEvent.create`. */
export interface EventEdition {
  sportLeagueId: string;
  sportLeagueSeasonId: string;
}

/** The time zone a test league's calendar weeks break in: test leagues keep UTC. */
export const TEST_LEAGUE_TIME_ZONE = 'UTC';

/**
 * The Season of `sportLeagueId` named for `championshipYear` (#2003). Seasons are added by
 * migration: a migration's league already has its recent ones, and a test's own league is given
 * the calendar-year Season it asks for, made on first use. Two first uses racing find the winner's.
 */
export async function fixtureSeasonId(
  prisma: Pick<PrismaClient, 'sportLeagueSeason'>,
  sportLeagueId: string,
  championshipYear: number,
): Promise<string> {
  const where = { sportLeagueId_championshipYear: { sportLeagueId, championshipYear } };
  try {
    return (await prisma.sportLeagueSeason.upsert({
      where,
      create: {
        sportLeagueId,
        championshipYear,
        name: String(championshipYear),
        startsAt: new Date(Date.UTC(championshipYear, 0, 1)),
        endsAt: new Date(Date.UTC(championshipYear + 1, 0, 1) - 1),
      },
      update: {},
      select: { id: true },
    })).id;
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    return (await prisma.sportLeagueSeason.findUniqueOrThrow({ where, select: { id: true } })).id;
  }
}

/**
 * Makes `championshipYear`'s Season `sportLeagueId`'s current one, made on first use: what the
 * daily recompute does for a migration's league, for a test league that creates events through
 * the API (a new event goes in the current Season).
 */
export async function withCurrentSeason(
  prisma: Pick<PrismaClient, 'sportLeagueSeason' | 'sportLeague' | 'sportLeaguePhase' | 'sportLeagueCompetition' | 'sportLeagueSeasonPhase' | 'sportLeagueSeasonCompetition'>,
  sportLeagueId: string,
  championshipYear = new Date().getUTCFullYear(),
): Promise<string> {
  const seasonId = await fixtureSeasonId(prisma, sportLeagueId, championshipYear);
  // A Season a migration adds has every phase and competition of its league; one a fixture made is
  // given them, so a test slot of any of the league's definitions can be added to it.
  const phases = await prisma.sportLeaguePhase.findMany({ where: { sportLeagueId }, select: { id: true } });
  await prisma.sportLeagueSeasonPhase.createMany({
    data: phases.map((phase) => ({ sportLeagueId, sportLeagueSeasonId: seasonId, sportLeaguePhaseId: phase.id })),
    skipDuplicates: true,
  });
  const competitions = await prisma.sportLeagueCompetition.findMany({ where: { sportLeagueId }, select: { id: true, sportLeaguePhaseId: true } });
  await prisma.sportLeagueSeasonCompetition.createMany({
    data: competitions.map((competition) => ({
      sportLeagueId, sportLeagueSeasonId: seasonId, sportLeaguePhaseId: competition.sportLeaguePhaseId, sportLeagueCompetitionId: competition.id,
    })),
    skipDuplicates: true,
  });
  await prisma.sportLeague.update({ where: { id: sportLeagueId }, data: { currentSeasonId: seasonId } });
  return seasonId;
}

export async function freshEventEdition(
  prisma: Db,
  options: { championshipYear?: number; onPgaTour?: boolean; sport?: Sport; sportLeagueId?: string } = {},
): Promise<EventEdition> {
  const sport = await sportRow(prisma, options.sport ?? Sport.GOLF);
  // Every contest setup is one sport league's (#1825), and the fixture tour has none: an event a
  // contest is made from a seeded setup on goes on the PGA TOUR, the migrations' own league. An
  // event is in its Season's league (#2004), so a test wanting a league of its own names it here.
  const tour = options.sportLeagueId !== undefined
    ? { id: options.sportLeagueId }
    : options.onPgaTour
      ? await prisma.sportLeague.findUniqueOrThrow({ where: { sportId_name: { sportId: sport.id, name: 'PGA TOUR' } } })
      : { id: await fixtureTourId(prisma, sport.sport) };
  const sportLeagueSeasonId = await fixtureSeasonId(prisma, tour.id, options.championshipYear ?? new Date().getUTCFullYear());
  return { sportLeagueId: tour.id, sportLeagueSeasonId };
}

/**
 * The fixture tour's id, made on first use. A provider feed's participants are the event league's
 * (#1853), so a test whose sync or live scores reach a `freshEventEdition` event puts its golfers
 * here. Like every league a migration adds (#2002), the tour has its phase and slot definitions: a
 * regular season of one tournament, the slot its Seasons and events link to once they have one.
 */
export async function fixtureTourId(prisma: Db, sportCode: Sport = Sport.GOLF): Promise<string> {
  const sport = await sportRow(prisma, sportCode);
  const where = { sportId_name: { sportId: sport.id, name: FIXTURE_TOUR_NAME } };
  let sportLeagueId: string;
  try {
    sportLeagueId = (await prisma.sportLeague.upsert({
      where,
      create: { ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: FIXTURE_TOUR_NAME, timeZone: TEST_LEAGUE_TIME_ZONE },
      update: {},
      select: { id: true },
    })).id;
  } catch (error) {
    // Two reads made it at once: the one that lost finds the winner's.
    if ((error as { code?: string }).code !== 'P2002') throw error;
    sportLeagueId = (await prisma.sportLeague.findUniqueOrThrow({ where, select: { id: true } })).id;
  }
  await fixtureTourStructure(prisma, sportLeagueId);
  return sportLeagueId;
}

const FIXTURE_TOUR_SLOT_KEY = 'FIXTURE_TOURNAMENT';

/** How the fixture tour's slot is played: as its league is scored, with no periods (test data only). */
async function fixtureSlotPlay(prisma: Db, sportLeagueId: string) {
  const { scoringFamily } = await prisma.sportLeague.findUniqueOrThrow({ where: { id: sportLeagueId }, select: { scoringFamily: true } });
  return { matchFormat: scoringFamily === 'HEAD_TO_HEAD' ? 'HEAD_TO_HEAD' as const : 'FIELD' as const, canEndTied: false };
}

/** The fixture tour's one phase, competition and slot; `skipDuplicates` lets two first uses race safely. */
async function fixtureTourStructure(prisma: Db, sportLeagueId: string): Promise<void> {
  const { competitionId } = await competitionFor(prisma, { sportLeagueId, phase: 'REGULAR' });
  await prisma.sportLeagueCompetitionSlot.createMany({
    data: [{
      sportLeagueId, sportLeagueCompetitionId: competitionId, key: FIXTURE_TOUR_SLOT_KEY, slotKind: 'TOURNAMENT',
      awardsTrophy: false, squaresEligible: false, seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED',
      ...(await fixtureSlotPlay(prisma, sportLeagueId)),
    }],
    skipDuplicates: true,
  });
}

/** The fixture tour's one slot definition: the slot a `freshEventEdition` event can be put in. */
export async function fixtureTourSlotId(prisma: Db, sportCode: Sport = Sport.GOLF): Promise<string> {
  const sportLeagueId = await fixtureTourId(prisma, sportCode);
  return (await prisma.sportLeagueCompetitionSlot.findUniqueOrThrow({ where: { sportLeagueId_key: { sportLeagueId, key: FIXTURE_TOUR_SLOT_KEY } }, select: { id: true } })).id;
}

/**
 * A slot definition of the league's own, in its phase's first competition (the regular season's
 * unless `phase` says otherwise), keyed `key` (made on first use):
 * a test that needs two events in different slots, or a template covering one of them (#2010).
 */
export async function keyedSlotDefinitionId(
  prisma: Db,
  sportLeagueId: string,
  key: string,
  options: { phase?: 'REGULAR' | 'POSTSEASON'; slotKind?: PrismaSlotKind; name?: string; pairing?: PrismaSlotPairing; seriesGames?: number } = {},
): Promise<string> {
  const { competitionId } = await competitionFor(prisma, { sportLeagueId, phase: options.phase ?? 'REGULAR' });
  await prisma.sportLeagueCompetitionSlot.createMany({
    data: [{
      sportLeagueId, sportLeagueCompetitionId: competitionId, key, slotKind: options.slotKind ?? 'TOURNAMENT', name: options.name ?? null,
      awardsTrophy: false, squaresEligible: false,
      seriesFormat: (options.seriesGames ?? 1) > 1 ? 'BEST_OF' : 'SINGLE_GAME', seriesGames: options.seriesGames ?? 1, pairing: options.pairing ?? 'FIXED',
      ...(await fixtureSlotPlay(prisma, sportLeagueId)),
    }],
    skipDuplicates: true,
  });
  return (await prisma.sportLeagueCompetitionSlot.findUniqueOrThrow({ where: { sportLeagueId_key: { sportLeagueId, key } }, select: { id: true } })).id;
}

/**
 * Puts the event in a Season slot of the definition (#2010): a test slot of its Season, labelled
 * by the event, so several tests' events can share one definition in one Season. Returns the
 * Season slot's id.
 */
export async function putEventInSlot(
  prisma: Pick<PrismaClient, 'sportEvent' | 'sportLeaguePhase' | 'sportLeagueCompetition' | 'sportLeagueCompetitionSlot' | 'sportLeagueSeasonPhase' | 'sportLeagueSeasonCompetition' | 'sportLeagueSeasonCompetitionSlot' | 'sportEventSlot'>,
  sportEventId: string,
  sportLeagueCompetitionSlotId: string,
  /** A synced slot (false) is unlabelled and makes no test event; a test slot is the default. */
  options: { isTestData?: boolean } = {},
): Promise<string> {
  const event = await prisma.sportEvent.findUniqueOrThrow({ where: { id: sportEventId }, select: { sportLeagueId: true, sportLeagueSeasonId: true } });
  const definition = await prisma.sportLeagueCompetitionSlot.findUniqueOrThrow({
    where: { id: sportLeagueCompetitionSlotId },
    select: { sportLeagueCompetitionId: true, competition: { select: { sportLeaguePhaseId: true } }, seriesFormat: true, seriesGames: true, pairing: true },
  });
  const seasonCompetitionId = await seasonCompetitionFor(prisma, {
    sportLeagueId: event.sportLeagueId,
    sportLeagueSeasonId: event.sportLeagueSeasonId,
    competition: { competitionId: definition.sportLeagueCompetitionId, phaseId: definition.competition.sportLeaguePhaseId },
  });
  const seasonSlot = await prisma.sportLeagueSeasonCompetitionSlot.create({
    data: {
      sportLeagueId: event.sportLeagueId, sportLeagueSeasonId: event.sportLeagueSeasonId, sportLeagueSeasonCompetitionId: seasonCompetitionId,
      sportLeagueCompetitionSlotId, seriesFormat: definition.seriesFormat, seriesGames: definition.seriesGames, pairing: definition.pairing,
      isTestData: options.isTestData ?? true, label: (options.isTestData ?? true) ? `event ${sportEventId}` : null,
    },
    select: { id: true },
  });
  await prisma.sportEventSlot.create({ data: { sportEventId, sportLeagueSeasonId: event.sportLeagueSeasonId, sportLeagueSeasonCompetitionSlotId: seasonSlot.id } });
  return seasonSlot.id;
}

/** A sport's row, made on first use (cleanupTestData clears the sports table). */
function sportRow(prisma: Db, sport: Sport) {
  return prisma.sport.upsert({ where: { sport }, create: { sport, ...sportRowKeys(sport), tournamentFormat: getDefaultTournamentFormatForSport(sport) }, update: {} });
}

/**
 * The events made on the fixture tour: a shared cleanup's own. An event a test makes on the PGA
 * TOUR is that test's to remove: other suites running beside it hold PGA TOUR events with rounds
 * and contests, which a sweep of the whole tour would reach (#2010; the series that once told a
 * fixture edition apart are gone).
 */
export const FIXTURE_EDITION_EVENTS: Prisma.SportEventWhereInput = {
  sportLeague: { name: FIXTURE_TOUR_NAME },
};

/**
 * The events the provider with this adapter id knows by `externalId` (#2004): through their
 * provider mappings, since an event holds no provider id of its own.
 */
export function providerEventWhere(providerId: string, externalId: string | Prisma.StringFilter): Prisma.SportEventWhereInput {
  return { providerMappings: { some: { provider: { code: requireProviderCodeOfSourceId(providerId) }, externalId } } };
}

/**
 * Gives an event its provider's id for it (#2004), as the sync writes it: a mapping under the
 * event's league's mapping to the provider league `providerLeagueCode` names (BALLDONTLIE's
 * `pga` unless a test names another), made on first use and not selected, so the league's own
 * sync stays as the test left it.
 */
export async function mapEventToProvider(
  prisma: Pick<PrismaClient, 'sportEvent' | 'providerLeague' | 'sportLeagueProviderMapping' | 'sportEventProviderMapping'>,
  sportEventId: string,
  ref: { providerId: string; externalId: string },
  providerLeagueCode = 'pga',
): Promise<void> {
  const { sportLeagueId } = await prisma.sportEvent.findUniqueOrThrow({
    where: { id: sportEventId },
    select: { sportLeagueId: true },
  });
  const providerLeague = await prisma.providerLeague.findFirstOrThrow({
    where: { code: providerLeagueCode, provider: { code: requireProviderCodeOfSourceId(ref.providerId) } },
    select: { id: true, providerId: true },
  });
  const leagueMapping = await prisma.sportLeagueProviderMapping.upsert({
    where: { sportLeagueId_providerLeagueId: { sportLeagueId, providerLeagueId: providerLeague.id } },
    create: { sportLeagueId, providerLeagueId: providerLeague.id },
    update: {},
    select: { id: true },
  });
  await prisma.sportEventProviderMapping.create({
    data: { sportEventId, providerId: providerLeague.providerId, sportLeagueProviderMappingId: leagueMapping.id, externalId: ref.externalId },
  });
}

/**
 * plans/147 — sync updates only an event already holding the provider's id for it; it never
 * creates one. This is the row a sync test starts from: an event on the fixture tour, mapped to the
 * provider's event (#2004) as the sync leaves it, already released (the column default,
 * SCHEDULED), with a four-round schedule, a round a day from the start, because a feed never
 * creates a round (#435).
 */
export async function linkedProviderEvent(
  prisma: Db & Pick<PrismaClient, 'sportEvent' | 'providerLeague' | 'sportLeagueProviderMapping' | 'sportEventProviderMapping' | 'sportLeagueSeasonPhase' | 'sportLeagueSeasonCompetition' | 'sportLeagueSeasonCompetitionSlot' | 'sportEventSlot' | 'sportEventRound'>,
  input: {
    providerId: string;
    externalId: string;
    name: string;
    startDate: Date;
    /** The event's sport league, the fixture tour unless named. */
    sportLeagueId?: string;
  },
) {
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma, { championshipYear: input.startDate.getUTCFullYear(), sportLeagueId: input.sportLeagueId })),
      name: input.name,
      startDate: input.startDate,
      rounds: LINKED_EVENT_ROUNDS,
    },
  });
  // The event's one synced slot, its four rounds played in it (#2006).
  // A Season holds one synced slot per definition, so each linked event plays a definition of its own.
  linkedEventCount += 1;
  const key = `${LINKED_EVENT_SLOT_KEY}_${String(randomInt(1, 1_000_000))}_${String(linkedEventCount)}`;
  const seasonSlotId = await putEventInSlot(prisma, event.id, await keyedSlotDefinitionId(prisma, event.sportLeagueId, key), { isTestData: false });
  const { id: sportEventSlotId } = await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id, sportLeagueSeasonCompetitionSlotId: seasonSlotId }, select: { id: true } });
  await prisma.sportEventRound.createMany({
    data: Array.from({ length: LINKED_EVENT_ROUNDS }, (_, index) => ({
      sportEventId: event.id,
      sportEventSlotId,
      roundNumber: index + 1,
      scheduledDate: new Date(input.startDate.getTime() + index * MS_PER_DAY),
    })),
  });
  await mapEventToProvider(prisma, event.id, { providerId: input.providerId, externalId: input.externalId });
  return event;
}

/**
 * Makes every template of the league cover every slot its events play (#2010), putting an event
 * that plays none in a test slot of one definition (TEST_TOURNAMENT) first. Templates are offered
 * by the slots an event plays, and until the sync gives events their slots (slice 8) a test's
 * loaded events play none, or only the test slot they were made on.
 */
export async function coverLeagueEventsWithTestSlot(prisma: PrismaClient, sportLeagueId: string): Promise<void> {
  const definitionId = await keyedSlotDefinitionId(prisma, sportLeagueId, 'TEST_TOURNAMENT');
  const unslotted = await prisma.sportEvent.findMany({ where: { sportLeagueId, slots: { none: {} } }, select: { id: true } });
  for (const event of unslotted) await putEventInSlot(prisma, event.id, definitionId);
  const played = await prisma.sportLeagueSeasonCompetitionSlot.findMany({
    where: { sportLeagueId, eventSlot: { isNot: null } },
    select: { sportLeagueCompetitionSlotId: true },
    distinct: ['sportLeagueCompetitionSlotId'],
  });
  const templates = await prisma.contestConfigTemplate.findMany({ where: { sportLeagueId }, select: { id: true } });
  await prisma.contestConfigTemplateSlot.createMany({
    data: templates.flatMap((template) => played.map((slot) => ({ sportLeagueId, templateId: template.id, sportLeagueCompetitionSlotId: slot.sportLeagueCompetitionSlotId }))),
    skipDuplicates: true,
  });
}

/** A round's slot as `eventRoundSlots` makes it: a definition of the league, keyed by its kind unless `key` is given. */
export interface TestRoundSlot {
  slotKind: PrismaSlotKind;
  key?: string;
  name?: string;
  pairing?: PrismaSlotPairing;
  seriesGames?: number;
}

/**
 * Puts the event in one Season slot per round (#2006), each of a postseason definition of its
 * league made on first use, in the order given (a bracket: its FINAL last). Answers each round's
 * SportEventSlot id, round 1 first, for rounds written straight to the database.
 */
export async function eventRoundSlots(
  prisma: Db & Pick<PrismaClient, 'sportEvent' | 'sportLeagueSeasonPhase' | 'sportLeagueSeasonCompetition' | 'sportLeagueSeasonCompetitionSlot' | 'sportEventSlot'>,
  sportEventId: string,
  slots: readonly TestRoundSlot[],
  /** Synced slots (false) keep a synced event synced; test slots are the default. */
  options: { isTestData?: boolean } = {},
): Promise<string[]> {
  const { sportLeagueId } = await prisma.sportEvent.findUniqueOrThrow({ where: { id: sportEventId }, select: { sportLeagueId: true } });
  const ids: string[] = [];
  for (const slot of slots) {
    const definitionId = await keyedSlotDefinitionId(prisma, sportLeagueId, slot.key ?? slot.slotKind, { phase: 'POSTSEASON', ...slot });
    const seasonSlotId = await putEventInSlot(prisma, sportEventId, definitionId, options);
    ids.push((await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId, sportLeagueSeasonCompetitionSlotId: seasonSlotId }, select: { id: true } })).id);
  }
  return ids;
}
