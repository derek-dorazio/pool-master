import type { Prisma, PrismaClient } from '@prisma/client';
import type { ContestCreate, ContestRepository } from '@poolmaster/shared/db';
import type { Contest, SelectionType } from '@poolmaster/shared/domain';
import { fixtureSeasonId, fixtureTourId, putEventInSlot } from './event-edition';
import { seasonCompetitionFor } from './competitions';
import { linkTestSlot } from './test-slots';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * What a fixture contest on these events covers (#2014): their Season and every Season slot of
 * theirs, as a contest made before covered slots covered its events whole. An event with no slot
 * yet is given the one `createRoundRows` would give it, so its rounds are placed in that slot. No
 * events at all puts the contest in a Season of this year (`anySeasonId`), covering nothing.
 */
export async function coverageOfEvents(prisma: Db, sportEventIds: readonly string[]): Promise<{ sportLeagueSeasonId: string; championshipYear: number; seasonSlotIds: string[] }> {
  // A draft on no event yet still sits in a Season, as the commissioner's form leaves one.
  if (sportEventIds.length === 0) {
    const championshipYear = new Date().getUTCFullYear();
    return { sportLeagueSeasonId: await anySeasonId(prisma, championshipYear), championshipYear, seasonSlotIds: [] };
  }
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
  return { sportLeagueSeasonId, championshipYear: await seasonYearOf(prisma, sportLeagueSeasonId), seasonSlotIds };
}

/** A Season's championship year, which a fixture contest copies as creation does (#2021). */
export async function seasonYearOf(prisma: Db, sportLeagueSeasonId: string): Promise<number> {
  return (await prisma.sportLeagueSeason.findUniqueOrThrow({ where: { id: sportLeagueSeasonId }, select: { championshipYear: true } })).championshipYear;
}

/** `prisma.contest.create` data for a fixture contest covering these events whole (`coverageOfEvents`). */
export async function contestOnEvents(prisma: Db, sportEventIds: readonly string[]): Promise<{
  sportLeagueSeasonId: string;
  championshipYear: number;
  seasonSlots: { create: { sportLeagueSeasonCompetitionSlotId: string }[] };
}> {
  const { sportLeagueSeasonId, championshipYear, seasonSlotIds } = await coverageOfEvents(prisma, sportEventIds);
  return { sportLeagueSeasonId, championshipYear, seasonSlots: { create: seasonSlotIds.map((sportLeagueSeasonCompetitionSlotId) => ({ sportLeagueSeasonCompetitionSlotId })) } };
}

/** A fixture contest as tests describe it: on its events, its Season and covered slots worked out. */
export type ContestOnEvents = Omit<ContestCreate, 'sportLeagueSeasonId' | 'seasonSlotIds' | 'championshipYear'> & { sportEventIds: readonly string[] };

/**
 * A contest written with no plan limit on its season's sports leagues (#947), for fixtures whose
 * subject is not the plan, covering its events whole.
 */
export async function createContestRow(prisma: Db, contests: Pick<ContestRepository, 'create'>, contest: ContestOnEvents): Promise<Contest> {
  const { sportEventIds, ...rest } = contest;
  const coverage = await coverageOfEvents(prisma, sportEventIds);
  const result = await contests.create({ ...rest, ...coverage }, { sportLeaguesPerYear: null });
  if (result.status !== 'created') throw new Error(`seed: contest refused (${result.status})`);
  return result.contest;
}

/**
 * A template for a fixture contest's configuration (#2014: every contest has one): the league's
 * first of the selection type, else a seeded league's (the first by id). A fixture makes no
 * template, so seeded templates stay the only ones; its rules live on its configuration.
 */
export async function fixtureTemplateId(prisma: Db, template: { sportLeagueId: string; selectionType: SelectionType }): Promise<string> {
  const order = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];
  const own = await prisma.contestConfigTemplate.findFirst({
    where: { sportLeagueId: template.sportLeagueId, selectionType: template.selectionType },
    orderBy: order,
    select: { id: true },
  });
  const found = own ?? await prisma.contestConfigTemplate.findFirst({
    where: { selectionType: template.selectionType, sportLeague: { displayOrder: { not: null } } },
    orderBy: order,
    select: { id: true },
  });
  if (found === null) throw new Error(`fixture: no seeded ${template.selectionType} template`);
  return found.id;
}

/**
 * A Season for a fixture contest with no events (#2014: every contest is in one): the fixture
 * tour's of the year, made on first use, so no fixture touches a seeded league's Seasons or templates.
 */
export async function anySeasonId(prisma: Db, championshipYear: number): Promise<string> {
  return fixtureSeasonId(prisma, await fixtureTourId(prisma), championshipYear);
}

/** `anySeasonId` with its year, as a fixture contest row needs both (#2021: the year is held to the Season). */
export async function anySeason(prisma: Db, championshipYear: number): Promise<{ sportLeagueSeasonId: string; championshipYear: number }> {
  return { sportLeagueSeasonId: await anySeasonId(prisma, championshipYear), championshipYear };
}

/** The fixture template (`fixtureTemplateId`) for a contest's configuration: its Season league's, of its type. */
export async function contestTemplateId(prisma: Db, contestId: string): Promise<string> {
  const contest = await prisma.contest.findUniqueOrThrow({
    where: { id: contestId },
    select: { selectionType: true, sportLeagueSeason: { select: { sportLeagueId: true } } },
  });
  return fixtureTemplateId(prisma, { sportLeagueId: contest.sportLeagueSeason.sportLeagueId, selectionType: contest.selectionType });
}

/** Adds events to a fixture contest's coverage (`coverageOfEvents`): their slots, in the contest's Season. */
export async function coverEvents(prisma: Db, contestId: string, sportEventIds: readonly string[]): Promise<void> {
  const { sportLeagueSeasonId, seasonSlotIds } = await coverageOfEvents(prisma, sportEventIds);
  await prisma.contestSeasonSlot.createMany({
    data: seasonSlotIds.map((sportLeagueSeasonCompetitionSlotId) => ({ contestId, sportLeagueSeasonId, sportLeagueSeasonCompetitionSlotId })),
  });
}

/**
 * A seeded template of the event's own league for a contest made through the API (#2014: every
 * contest is made from a template and covers a slot it lists): its active default of the selection
 * type, else its first, with the event put in a Season slot of the template's first listed
 * definition unless it already holds a listed one.
 */
export async function templateForEvent(prisma: PrismaClient, sportEventId: string, selectionType: SelectionType): Promise<string> {
  const event = await prisma.sportEvent.findUniqueOrThrow({ where: { id: sportEventId }, select: { sportLeagueId: true } });
  const template = await prisma.contestConfigTemplate.findFirstOrThrow({
    where: { sportLeagueId: event.sportLeagueId, selectionType, active: true },
    orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  await placeEventForTemplate(prisma, sportEventId, template.id);
  return template.id;
}

/** Puts the event in the template's first listed slot unless it already holds a listed one. */
export async function placeEventForTemplate(prisma: PrismaClient, sportEventId: string, templateId: string): Promise<void> {
  const [event, template] = await Promise.all([
    prisma.sportEvent.findUniqueOrThrow({
      where: { id: sportEventId },
      select: { sportLeagueId: true, sportLeagueSeasonId: true, slots: { select: { seasonSlot: { select: { id: true, sportLeagueCompetitionSlotId: true, label: true } } }, orderBy: { id: 'asc' } } },
    }),
    prisma.contestConfigTemplate.findUniqueOrThrow({
      where: { id: templateId },
      select: { slots: { select: { definition: { select: { id: true, sportLeagueCompetitionId: true, competition: { select: { sportLeaguePhaseId: true } } } } }, orderBy: { id: 'asc' } } },
    }),
  ]);
  const listed = new Set(template.slots.map((slot) => slot.definition.id));
  if (event.slots.some((slot) => listed.has(slot.seasonSlot.sportLeagueCompetitionSlotId))) return;
  // poolmaster-allow-position: the template's first listed slot, in id order
  const first = template.slots.at(0)?.definition;
  if (first === undefined) throw new Error(`fixture: template ${templateId} lists no slot`);
  // poolmaster-allow-position: an event in a slot the template does not list moves its first one
  const held = event.slots.at(0)?.seasonSlot;
  if (held === undefined) {
    await putEventInSlot(prisma, sportEventId, first.id);
    return;
  }
  // The event's own slot takes the listed definition, keeping the tiers, prices and rounds on it.
  const seasonCompetitionId = await seasonCompetitionFor(prisma, {
    sportLeagueId: event.sportLeagueId,
    sportLeagueSeasonId: event.sportLeagueSeasonId,
    competition: { competitionId: first.sportLeagueCompetitionId, phaseId: first.competition.sportLeaguePhaseId },
  });
  // A label of the event's own keeps it apart from a Season slot the definition already has.
  const label = held.label ?? `event ${sportEventId}`;
  const taken = await prisma.sportLeagueSeasonCompetitionSlot.count({
    where: { sportLeagueSeasonId: event.sportLeagueSeasonId, sportLeagueCompetitionSlotId: first.id, label, id: { not: held.id } },
  });
  await prisma.sportLeagueSeasonCompetitionSlot.update({
    where: { id: held.id },
    data: { sportLeagueCompetitionSlotId: first.id, sportLeagueSeasonCompetitionId: seasonCompetitionId, label: taken === 0 ? label : `${label} (event ${sportEventId})`, isTestData: true },
  });
}
