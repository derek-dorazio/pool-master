/**
 * plans/147 — every SportEvent is one edition of an EventSeries, in one event year, and a
 * series has at most one edition per year. A test that writes an event row directly needs
 * both, and usually does not care about either.
 *
 * `freshEventEdition` gives each such event a series of its own on a shared fixture tour, so
 * two fixtures never collide on the one-edition-per-year constraint by accident. A test about
 * series, years or that constraint builds its own series instead.
 *
 * The fixture tour hangs off the GOLF sport row by default, because the sport list validates names
 * against the Sport enum; a made-up sport row would break any contract test that lists sports. An
 * event reads its sport through its series' league (#2042), so a test about another sport's event
 * names that sport, and its series goes on that sport's own fixture league.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Sport } from '@poolmaster/shared/domain';
import { sportLeagueRowDefaults } from './league-profiles';
import { sportRowKeys } from './sport-rows';

export const FIXTURE_TOUR_NAME = 'Fixture Tour (plans/147 test editions)';
/** Starts every fixture series' name, so its cleanup finds the ones on the PGA TOUR too. */
const FIXTURE_SERIES_PREFIX = 'Fixture edition: ';

const LINKED_EVENT_ROUNDS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Db = Pick<PrismaClient, 'sport' | 'sportLeague' | 'sportLeaguePhase' | 'sportLeaguePhaseSlot' | 'eventSeries' | 'platformTierProfile' | 'platformPricingProfile'>;

export interface EventEdition {
  eventSeriesId: string;
  eventYear: number;
}

export async function freshEventEdition(
  prisma: Db,
  options: { name?: string; eventYear?: number; onPgaTour?: boolean; sport?: Sport } = {},
): Promise<EventEdition> {
  const sport = await upsertSportRow(prisma, options.sport ?? 'GOLF');
  // Every contest setup is one sport league's (#1825), and the fixture tour has none: an event a
  // contest is made from a seeded setup on goes on the PGA TOUR, the migrations' own league.
  const tour = options.onPgaTour
    ? await prisma.sportLeague.findUniqueOrThrow({ where: { sportId_name: { sportId: sport.id, name: 'PGA TOUR' } } })
    : { id: await fixtureTourId(prisma, options.sport ?? 'GOLF') };
  const series = await prisma.eventSeries.create({
    data: { sportLeagueId: tour.id, name: `${FIXTURE_SERIES_PREFIX}${options.name ?? 'Fixture series'} ${randomUUID()}` },
  });
  return { eventSeriesId: series.id, eventYear: options.eventYear ?? new Date().getUTCFullYear() };
}

/** The sport's reference row, restored as the migration made it in case a suite cleared it. */
async function upsertSportRow(prisma: Db, sport: Sport) {
  const individual = sport === 'GOLF' || sport === 'HORSE_RACING' || sport === 'AUTO_RACING' || sport === 'CYCLING' || sport === 'RUNNING' || sport === 'TENNIS';
  const race = sport === 'HORSE_RACING' || sport === 'AUTO_RACING' || sport === 'CYCLING' || sport === 'RUNNING';
  return prisma.sport.upsert({
    where: { sport },
    create: {
      sport,
      ...sportRowKeys(sport),
      participantType: individual ? 'INDIVIDUAL' : 'TEAM',
      tournamentFormat: sport === 'GOLF' ? 'STROKE_PLAY_TOURNAMENT' : race ? 'RACE' : 'MATCHES',
    },
    update: {},
  });
}

/**
 * The fixture tour's id, made on first use. A provider feed's participants are the event league's
 * (#1853), so a test whose sync or live scores reach a `freshEventEdition` event puts its golfers
 * here. Like every league a migration adds (#2002), the tour has its phase and slot definitions: a
 * regular season of one tournament, the slot its Seasons and events link to once they have one.
 */
export async function fixtureTourId(prisma: Db, sportCode: Sport = 'GOLF'): Promise<string> {
  const sport = await upsertSportRow(prisma, sportCode);
  const where = { sportId_name: { sportId: sport.id, name: FIXTURE_TOUR_NAME } };
  let sportLeagueId: string;
  try {
    sportLeagueId = (await prisma.sportLeague.upsert({
      where,
      create: { ...(await sportLeagueRowDefaults(prisma)), sportId: sport.id, name: FIXTURE_TOUR_NAME },
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
      ...(await freshEventEdition(prisma, { name: input.name, eventYear: input.startDate.getUTCFullYear() })),
      providerId: input.providerId,
      externalId: input.externalId,
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
