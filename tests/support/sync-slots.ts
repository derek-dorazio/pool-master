/**
 * Synced-slot fixtures (league model slice 8, #2005): the events sync puts a provider's games on the
 * Season slots its league's slot provider mappings name by code, and makes an event only where a
 * contest template lists the slot. A migration's league has its definitions, mappings and
 * templates; a league a test made has none, so this adds them. Test code only.
 */
import type { PrismaClient } from '@prisma/client';
import { competitionFor, seasonCompetitionFor } from './competitions';

type Db = Pick<PrismaClient,
  'sportLeaguePhase' | 'sportLeagueCompetition' | 'sportLeagueCompetitionSlot' | 'sportLeagueCompetitionSlotProviderMapping' | 'sportLeagueSeasonPhase'
  | 'sportLeagueSeasonCompetition'
  | 'sportLeagueSeasonCompetitionSlot' | 'contestConfigTemplate' | 'contestConfigTemplateSlot'>;

let definitionCount = 0;

/**
 * The key of the template a test lists its synced slots on. A league with a template is kept as
 * reference data, so the integration cleanup deletes these first.
 */
export const COVERING_TEMPLATE_KEY = 'sync-slot-cover';

/** A Season slot's date window as a test sets it (#2012). */
export interface TestSlotWindow {
  startsAt: Date;
  endsAt: Date;
  status: 'TENTATIVE' | 'CONFIRMED';
}

/**
 * A slot definition of the league mapped by the PROVIDER_CODE `code` at its provider mapping, or
 * by DATE_WINDOW when `code` is null, played by one synced Season slot in each of `seasonIds` (with
 * `window` as each one's date window, when given), and listed by an active contest template unless
 * `covered` is false. Answers the Season slot ids in the order of `seasonIds`.
 */
export async function syncSlotsFor(
  prisma: Db,
  input: { sportLeagueId: string; sportLeagueProviderMappingId: string; code: string | null; seasonIds: readonly string[]; covered?: boolean; window?: TestSlotWindow },
): Promise<string[]> {
  return (await slotDefinitionFor(prisma, { ...input, matchType: input.code === null ? 'DATE_WINDOW' : 'PROVIDER_CODE', value: input.code })).seasonSlotIds;
}

/**
 * A tournament's slot definition matched by the NAME_PATTERN `pattern` at the league's provider
 * mapping (#2011), listed by an active contest template unless `covered` is false, with its
 * competition in each of `seasonIds` but no Season slot: the events sync creates that when a tournament's name
 * first matches. Answers the definition's id.
 */
export async function nameSlotDefinitionFor(
  prisma: Db,
  input: { sportLeagueId: string; sportLeagueProviderMappingId: string; pattern: string; seasonIds: readonly string[]; covered?: boolean },
): Promise<string> {
  return (await slotDefinitionFor(prisma, { ...input, matchType: 'NAME_PATTERN', value: input.pattern, seasonSlots: false })).definitionId;
}

async function slotDefinitionFor(
  prisma: Db,
  input: {
    sportLeagueId: string; sportLeagueProviderMappingId: string; matchType: 'PROVIDER_CODE' | 'NAME_PATTERN' | 'DATE_WINDOW'; value: string | null;
    seasonIds: readonly string[]; covered?: boolean; seasonSlots?: boolean; window?: TestSlotWindow;
  },
): Promise<{ definitionId: string; seasonSlotIds: string[] }> {
  const { sportLeagueId } = input;
  const competition = await competitionFor(prisma, { sportLeagueId, phase: 'REGULAR' });
  const definition = await prisma.sportLeagueCompetitionSlot.create({
    data: {
      sportLeagueId,
      sportLeagueCompetitionId: competition.competitionId,
      // A definition key is upper-case letters, digits and underscores, never the provider's code.
      key: `SYNC_SLOT_${String(process.pid)}_${String(++definitionCount)}`,
      slotKind: 'TOURNAMENT',
      awardsTrophy: false,
      squaresEligible: false,
      seriesFormat: 'SINGLE_GAME',
      seriesGames: 1,
      pairing: 'FIXED',
      matchFormat: 'FIELD',
      canEndTied: false,
    },
    select: { id: true },
  });
  await prisma.sportLeagueCompetitionSlotProviderMapping.create({
    data: {
      sportLeagueId,
      sportLeagueCompetitionSlotId: definition.id,
      sportLeagueProviderMappingId: input.sportLeagueProviderMappingId,
      matchType: input.matchType,
      providerValue: input.value,
    },
  });
  if (input.covered ?? true) {
    const template = await prisma.contestConfigTemplate.upsert({
      where: { sportLeagueId_templateKey: { sportLeagueId, templateKey: COVERING_TEMPLATE_KEY } },
      create: {
        sportLeagueId,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        templateKey: COVERING_TEMPLATE_KEY,
        name: 'Synced slot pool',
        description: 'Lists the synced slots a test made.',
        sortOrder: 999,
        coverageMode: 'ONE_SLOT',
        configJson: {},
      },
      update: {},
      select: { id: true },
    });
    await prisma.contestConfigTemplateSlot.create({ data: { sportLeagueId, templateId: template.id, sportLeagueCompetitionSlotId: definition.id } });
  }
  const ids: string[] = [];
  for (const sportLeagueSeasonId of input.seasonIds) {
    const seasonCompetitionId = await seasonCompetitionFor(prisma, { sportLeagueId, sportLeagueSeasonId, competition });
    if (input.seasonSlots === false) continue;
    ids.push((await prisma.sportLeagueSeasonCompetitionSlot.create({
      data: {
        sportLeagueId, sportLeagueSeasonId, sportLeagueSeasonCompetitionId: seasonCompetitionId, sportLeagueCompetitionSlotId: definition.id,
        seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED',
        ...(input.window && { windowStartsAt: input.window.startsAt, windowEndsAt: input.window.endsAt, windowStatus: input.window.status }),
      },
      select: { id: true },
    })).id);
  }
  return { definitionId: definition.id, seasonSlotIds: ids };
}
