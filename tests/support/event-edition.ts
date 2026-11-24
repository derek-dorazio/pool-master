/**
 * plans/147, #2003 — every SportEvent is one edition of an EventSeries, in one Season of its
 * league, and a series has at most one edition per Season. A test that writes an event row
 * directly needs both, and usually does not care about either.
 *
 * `freshEventEdition` gives each such event a series of its own on a shared fixture tour, so
 * two fixtures never collide on the one-edition-per-Season constraint by accident. A test about
 * series, Seasons or that constraint builds its own series instead.
 *
 * The fixture tour hangs off a real sport row (GOLF unless the test names another) because the
 * sport list validates names against the Sport enum; a made-up sport row would break any contract
 * test that lists sports. Each sport has its own fixture tour, playing as that sport's leagues are
 * seeded, since an event is scored by its league's family (#2001).
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { getDefaultTournamentFormatForSport, Sport } from '@poolmaster/shared/domain';
import { leagueProfiles } from './league-profiles';
import { sportPlay } from './sport-play';

export const FIXTURE_TOUR_NAME = 'Fixture Tour (plans/147 test editions)';
/** Starts every fixture series' name, so its cleanup finds the ones on the PGA TOUR too. */
const FIXTURE_SERIES_PREFIX = 'Fixture edition: ';

const LINKED_EVENT_ROUNDS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Db = Pick<PrismaClient, 'sport' | 'sportLeague' | 'sportLeaguePhase' | 'sportLeaguePhaseSlot' | 'sportLeagueSeason' | 'eventSeries' | 'platformTierProfile' | 'platformPricingProfile'>;

export interface EventEdition {
  eventSeriesId: string;
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
  prisma: Pick<PrismaClient, 'sportLeagueSeason' | 'sportLeague'>,
  sportLeagueId: string,
  championshipYear = new Date().getUTCFullYear(),
): Promise<string> {
  const seasonId = await fixtureSeasonId(prisma, sportLeagueId, championshipYear);
  await prisma.sportLeague.update({ where: { id: sportLeagueId }, data: { currentSeasonId: seasonId } });
  return seasonId;
}

/** The Season named for `championshipYear` of the league `eventSeriesId` belongs to. */
export async function seriesSeasonId(
  prisma: Pick<PrismaClient, 'sportLeagueSeason' | 'eventSeries'>,
  eventSeriesId: string,
  championshipYear: number,
): Promise<string> {
  const { sportLeagueId } = await prisma.eventSeries.findUniqueOrThrow({ where: { id: eventSeriesId }, select: { sportLeagueId: true } });
  return fixtureSeasonId(prisma, sportLeagueId, championshipYear);
}

export async function freshEventEdition(
  prisma: Db,
  options: { name?: string; championshipYear?: number; onPgaTour?: boolean; sport?: Sport } = {},
): Promise<EventEdition> {
  const sport = await sportRow(prisma, options.sport ?? Sport.GOLF);
  // Every contest setup is one sport league's (#1825), and the fixture tour has none: an event a
  // contest is made from a seeded setup on goes on the PGA TOUR, the migrations' own league.
  const tour = options.onPgaTour
    ? await prisma.sportLeague.findUniqueOrThrow({ where: { sportId_name: { sportId: sport.id, name: 'PGA TOUR' } } })
    : { id: await fixtureTourId(prisma, sport.sport) };
  const series = await prisma.eventSeries.create({
    data: { sportLeagueId: tour.id, name: `${FIXTURE_SERIES_PREFIX}${options.name ?? 'Fixture series'} ${randomUUID()}` },
  });
  const sportLeagueSeasonId = await fixtureSeasonId(prisma, tour.id, options.championshipYear ?? new Date().getUTCFullYear());
  return { eventSeriesId: series.id, sportLeagueSeasonId };
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
      create: { ...(await leagueProfiles(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: FIXTURE_TOUR_NAME, timeZone: TEST_LEAGUE_TIME_ZONE },
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

/** The fixture tour's one phase and slot; `skipDuplicates` lets two first uses race safely. */
async function fixtureTourStructure(prisma: Db, sportLeagueId: string): Promise<void> {
  await prisma.sportLeaguePhase.createMany({ data: [{ sportLeagueId, phase: 'REGULAR', isSynced: true }], skipDuplicates: true });
  const phase = await prisma.sportLeaguePhase.findUniqueOrThrow({ where: { sportLeagueId_phase: { sportLeagueId, phase: 'REGULAR' } }, select: { id: true } });
  await prisma.sportLeaguePhaseSlot.createMany({
    data: [{
      sportLeagueId, sportLeaguePhaseId: phase.id, key: FIXTURE_TOUR_SLOT_KEY, slotKind: 'TOURNAMENT',
      awardsTrophy: false, squaresEligible: false, seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED',
    }],
    skipDuplicates: true,
  });
}

/** Removes the fixture series, on the fixture tour or the PGA TOUR, that no event uses any more. */
/** A sport's row, made on first use (cleanupTestData clears the sports table). */
function sportRow(prisma: Db, sport: Sport) {
  return prisma.sport.upsert({ where: { sport }, create: { sport, tournamentFormat: getDefaultTournamentFormatForSport(sport) }, update: {} });
}

export async function cleanupFreshEventEditions(prisma: Pick<PrismaClient, 'eventSeries'>): Promise<void> {
  await prisma.eventSeries.deleteMany({
    where: {
      OR: [{ sportLeague: { name: FIXTURE_TOUR_NAME } }, { name: { startsWith: FIXTURE_SERIES_PREFIX } }],
      sportEvents: { none: {} },
    },
  });
}

/**
 * plans/147 — sync updates only an event already linked to the provider event; it never
 * creates one. This is the row a sync test starts from: an event in a fresh series, holding
 * the provider identity, as an admin creating and linking it would leave it, already released
 * (the column default, SCHEDULED). Like an admin-created event it is
 * linked for scores (SCORES_ONLY) and has a four-round schedule, a round a day from the start,
 * because a feed never creates a round (#435).
 */
export async function linkedProviderEvent(
  prisma: Db & Pick<PrismaClient, 'sportEvent'>,
  input: {
    providerId: string;
    externalId: string;
    name: string;
    startDate: Date;
  },
) {
  return prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma, { name: input.name, championshipYear: input.startDate.getUTCFullYear() })),
      providerId: input.providerId,
      externalId: input.externalId,
      sport: 'GOLF',
      name: input.name,
      startDate: input.startDate,
      syncScope: 'SCORES_ONLY',
      rounds: LINKED_EVENT_ROUNDS,
      roundSchedule: {
        create: Array.from({ length: LINKED_EVENT_ROUNDS }, (_, index) => ({
          roundNumber: index + 1,
          scheduledDate: new Date(input.startDate.getTime() + index * MS_PER_DAY),
        })),
      },
    },
  });
}
