import type { Prisma, PrismaClient } from '@prisma/client';
import type { ContestCreate, ContestRepository } from '@poolmaster/shared/db';
import type { Contest, ContestFormat, SelectionType } from '@poolmaster/shared/domain';
import { linkTestSlot } from './test-slots';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * What a fixture contest on these events covers (#2014): their Season and every Season slot of
 * theirs, as a contest made before covered slots covered its events whole. An event with no slot
 * yet is given the one `createRoundRows` would give it, so its rounds are placed in that slot.
 */
export async function coverageOfEvents(prisma: Db, sportEventIds: readonly string[]): Promise<{ sportLeagueSeasonId: string; seasonSlotIds: string[] }> {
  const events = await prisma.sportEvent.findMany({
    where: { id: { in: [...sportEventIds] } },
    select: { id: true, sportLeagueSeasonId: true, startDate: true, slots: { select: { sportLeagueSeasonCompetitionSlotId: true } } },
  });
  const seasons = new Set(events.map((event) => event.sportLeagueSeasonId));
  if (events.length !== new Set(sportEventIds).size || seasons.size !== 1) {
    throw new Error(`fixture: a contest covers found events of one Season (${String(events.length)} events, ${String(seasons.size)} Seasons)`);
  }
  const seasonSlotIds: string[] = [];
  for (const event of [...events].sort((left, right) => left.startDate.getTime() - right.startDate.getTime())) {
    if (event.slots.length === 0) {
      // poolmaster-allow-query-in-loop: a fixture's few events, each given its one slot
      seasonSlotIds.push(await linkTestSlot(prisma, event, false));
    } else {
      seasonSlotIds.push(...event.slots.map((slot) => slot.sportLeagueSeasonCompetitionSlotId));
    }
  }
  const [sportLeagueSeasonId] = seasons;
  return { sportLeagueSeasonId, seasonSlotIds };
}

/** `prisma.contest.create` data for a fixture contest covering these events whole (`coverageOfEvents`). */
export async function contestOnEvents(prisma: Db, sportEventIds: readonly string[]): Promise<{
  sportLeagueSeasonId: string;
  seasonSlots: { create: { sportLeagueSeasonCompetitionSlotId: string }[] };
}> {
  const { sportLeagueSeasonId, seasonSlotIds } = await coverageOfEvents(prisma, sportEventIds);
  return { sportLeagueSeasonId, seasonSlots: { create: seasonSlotIds.map((sportLeagueSeasonCompetitionSlotId) => ({ sportLeagueSeasonCompetitionSlotId })) } };
}

/** A fixture contest as tests describe it: on its events, its Season and covered slots worked out. */
export type ContestOnEvents = Omit<ContestCreate, 'sportLeagueSeasonId' | 'seasonSlotIds' | 'seasonYear'> & { sportEventIds: readonly string[] };

/**
 * A contest written with no plan limit on its season's sports leagues (#947), for fixtures whose
 * subject is not the plan, covering its events whole.
 */
export async function createContestRow(prisma: Db, contests: Pick<ContestRepository, 'create'>, contest: ContestOnEvents): Promise<Contest> {
  const { sportEventIds, ...rest } = contest;
  const coverage = await coverageOfEvents(prisma, sportEventIds);
  const { championshipYear } = await prisma.sportLeagueSeason.findUniqueOrThrow({ where: { id: coverage.sportLeagueSeasonId }, select: { championshipYear: true } });
  const result = await contests.create({ ...rest, ...coverage, seasonYear: championshipYear }, { sportLeaguesPerYear: null });
  if (result.status !== 'created') throw new Error(`seed: contest refused (${result.status})`);
  return result.contest;
}

/**
 * A template for a fixture contest's configuration (#2014: every contest has one): the league's
 * first of the selection type, else one made now under the key `fixture-<type>`. A test league's
 * templates go with it (`deleteTestSportLeagues`).
 */
export async function fixtureTemplateId(prisma: Db, template: {
  sportLeagueId: string;
  selectionType: SelectionType;
  contestFormat: ContestFormat;
  configJson: Prisma.InputJsonValue;
}): Promise<string> {
  const existing = await prisma.contestConfigTemplate.findFirst({
    where: { sportLeagueId: template.sportLeagueId, selectionType: template.selectionType },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.contestConfigTemplate.create({
    data: {
      ...template,
      templateKey: `fixture-${template.selectionType.toLowerCase()}`,
      name: `Fixture ${template.selectionType}`,
      description: 'A test fixture template.',
      sortOrder: 999,
      coverageMode: 'ALL_LISTED',
    },
    select: { id: true },
  });
  return created.id;
}
