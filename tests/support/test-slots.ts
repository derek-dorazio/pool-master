/**
 * Test-slot fixtures (#2004): a test event is made on a labelled test slot of its league's current
 * Season, and a test slot plays one of the league's slot definitions in that Season's competition
 * for it (#2153). A seeded league has its definitions and its Seasons' competitions from its
 * migrations; a league a test made through the API has neither, so this adds one TOURNAMENT
 * definition (key TEST_EVENT) in a REGULAR competition for it. Test code only.
 */
import type { PrismaClient } from '@prisma/client';
import { competitionFor, seasonCompetitionFor, type TestCompetition } from './competitions';

type Db = Pick<PrismaClient, 'sportLeaguePhase' | 'sportLeagueCompetition' | 'sportLeagueCompetitionSlot' | 'sportLeagueSeasonPhase' | 'sportLeagueSeasonCompetition'>;

/** A slot definition with the competition and phase it is in. */
interface TestDefinition {
  id: string;
  competition: TestCompetition;
}

const DEFINITION_SELECT = { id: true, sportLeagueCompetitionId: true, competition: { select: { sportLeaguePhaseId: true } } } as const;

function testDefinitionOf(row: { id: string; sportLeagueCompetitionId: string; competition: { sportLeaguePhaseId: string } }): TestDefinition {
  return { id: row.id, competition: { competitionId: row.sportLeagueCompetitionId, phaseId: row.competition.sportLeaguePhaseId } };
}

/** The key of the slot definition a test makes for a league that has none; a test data file names it. */
export const TEST_DEFINITION_KEY = 'TEST_EVENT';

/** The league's first slot definition (by key), or its TEST_EVENT definition made now when it has none. */
async function slotDefinitionOf(prisma: Db, sportLeagueId: string): Promise<TestDefinition> {
  const existing = await prisma.sportLeagueCompetitionSlot.findFirst({
    where: { sportLeagueId },
    select: DEFINITION_SELECT,
    orderBy: { key: 'asc' },
  });
  return existing === null ? createTestDefinition(prisma, sportLeagueId) : testDefinitionOf(existing);
}

/**
 * The league's TEST_EVENT definition, made now when it has none: for a test data file whose events
 * the league has no definition for yet (a migration's league with no group-stage slots). A test
 * that makes one on a migration's league removes it afterwards (`removeTestDefinition`).
 */
export async function withTestDefinition(prisma: Db, sportLeagueId: string): Promise<string> {
  const existing = await prisma.sportLeagueCompetitionSlot.findFirst({ where: { sportLeagueId, key: TEST_DEFINITION_KEY }, select: { id: true } });
  return (existing ?? await createTestDefinition(prisma, sportLeagueId)).id;
}

/** Removes the league's TEST_EVENT definition and the test slots of it, once their events are gone. */
export async function removeTestDefinition(prisma: Db & Pick<PrismaClient, 'sportLeagueSeasonCompetitionSlot'>, sportLeagueId: string): Promise<void> {
  const where = { sportLeagueId, key: TEST_DEFINITION_KEY };
  await prisma.sportLeagueSeasonCompetitionSlot.deleteMany({ where: { definition: where } });
  await prisma.sportLeagueCompetitionSlot.deleteMany({ where });
}

async function createTestDefinition(prisma: Db, sportLeagueId: string): Promise<TestDefinition> {
  const competition = await competitionFor(prisma, { sportLeagueId, phase: 'REGULAR' });
  return testDefinitionOf(await prisma.sportLeagueCompetitionSlot.create({
    data: {
      sportLeagueId,
      sportLeagueCompetitionId: competition.competitionId,
      key: TEST_DEFINITION_KEY,
      slotKind: 'TOURNAMENT',
      awardsTrophy: false,
      squaresEligible: true,
      seriesFormat: 'SINGLE_GAME',
      seriesGames: 1,
      pairing: 'FIXED',
      matchFormat: 'HEAD_TO_HEAD',
      canEndTied: false,
    },
    select: DEFINITION_SELECT,
  }));
}

/**
 * A slot definition of the league that a test slot can be added to in `sportLeagueSeasonId`: the
 * Season gets the definition's competition when it lacks it (a Season a fixture made has none).
 */
export async function testSlotDefinitionId(prisma: Db, sportLeagueId: string, sportLeagueSeasonId: string): Promise<string> {
  return (await testSlotPlaceIn(prisma, sportLeagueId, sportLeagueSeasonId)).definitionId;
}

/** The definition a test slot plays and the Season competition it goes in, made when missing. */
async function testSlotPlaceIn(prisma: Db, sportLeagueId: string, sportLeagueSeasonId: string): Promise<{ definitionId: string; seasonCompetitionId: string }> {
  const definition = await slotDefinitionOf(prisma, sportLeagueId);
  const seasonCompetitionId = await seasonCompetitionFor(prisma, { sportLeagueId, sportLeagueSeasonId, competition: definition.competition });
  return { definitionId: definition.id, seasonCompetitionId };
}

let labelCount = 0;

/** A label no other test slot of this run has. */
export function uniqueTestSlotLabel(): string {
  labelCount += 1;
  return `T${process.pid}-${Date.now().toString(36)}-${labelCount}`;
}

/**
 * A labelled test slot in the league's current Season, starting `startsAt`, written straight to
 * the database for a test below the API (the route is `createTestSlot`). Answers its id.
 */
export async function testSlotId(
  prisma: Db & Pick<PrismaClient, 'sportLeague' | 'sportLeagueSeasonCompetitionSlot'>,
  sportLeagueId: string,
  startsAt: Date,
  endsAt: Date | null = null,
): Promise<string> {
  const { currentSeasonId } = await prisma.sportLeague.findUniqueOrThrow({ where: { id: sportLeagueId }, select: { currentSeasonId: true } });
  if (currentSeasonId === null) throw new Error(`Sport league ${sportLeagueId} has no current Season for a test slot.`);
  return testSlotIdIn(prisma, sportLeagueId, currentSeasonId, startsAt, endsAt);
}

/** A labelled test slot in the given Season of the league, written straight to the database. Answers its id. */
export async function testSlotIdIn(
  prisma: Db & Pick<PrismaClient, 'sportLeagueSeasonCompetitionSlot'>,
  sportLeagueId: string,
  sportLeagueSeasonId: string,
  startsAt: Date,
  endsAt: Date | null = null,
): Promise<string> {
  const { definitionId, seasonCompetitionId } = await testSlotPlaceIn(prisma, sportLeagueId, sportLeagueSeasonId);
  return (await prisma.sportLeagueSeasonCompetitionSlot.create({
    data: {
      sportLeagueId, sportLeagueSeasonId, sportLeagueSeasonCompetitionId: seasonCompetitionId, sportLeagueCompetitionSlotId: definitionId,
      startsAt, endsAt, seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED', isTestData: true, label: uniqueTestSlotLabel(),
    },
    select: { id: true },
  })).id;
}

/**
 * Makes an event a test event, as one created on a test slot is: a test slot in its Season, linked
 * to it. Written straight to the database for a test below the API.
 */
export async function linkTestSlot(
  prisma: Db & Pick<PrismaClient, 'sportLeagueSeasonCompetitionSlot' | 'sportEventSlot' | 'sportLeagueSeason'>,
  event: { id: string; sportLeagueSeasonId: string; startDate: Date },
): Promise<string> {
  const { sportLeagueId } = await prisma.sportLeagueSeason.findUniqueOrThrow({ where: { id: event.sportLeagueSeasonId }, select: { sportLeagueId: true } });
  const slotId = await testSlotIdIn(prisma, sportLeagueId, event.sportLeagueSeasonId, event.startDate);
  await prisma.sportEventSlot.create({
    data: { sportEventId: event.id, sportLeagueSeasonId: event.sportLeagueSeasonId, sportLeagueSeasonCompetitionSlotId: slotId },
    select: { id: true },
  });
  return slotId;
}

/**
 * Deletes test sport leagues. A Season's phases and slots restrict their definitions' deletes, so
 * the league's cascade cannot take them: they go first, slots before competitions before phases (as the API's delete does).
 */
export async function deleteTestSportLeagues(
  prisma: Pick<PrismaClient, 'sportLeague' | 'sportLeagueSeasonPhase' | 'sportLeagueSeasonCompetition' | 'sportLeagueSeasonCompetitionSlot'>,
  sportLeagueIds: readonly string[],
): Promise<void> {
  const ids = [...sportLeagueIds];
  await prisma.sportLeagueSeasonCompetitionSlot.deleteMany({ where: { sportLeagueId: { in: ids } } });
  await prisma.sportLeagueSeasonCompetition.deleteMany({ where: { sportLeagueId: { in: ids } } });
  await prisma.sportLeagueSeasonPhase.deleteMany({ where: { sportLeagueId: { in: ids } } });
  await prisma.sportLeague.deleteMany({ where: { id: { in: ids } } });
}
