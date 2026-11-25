/**
 * Synced-slot fixtures (league model slice 8, #2005): the events sync puts a provider's games on the
 * Season slots its league's slot provider mappings name by code, and makes an event only where a
 * contest template lists the slot. A migration's league has its definitions, mappings and
 * templates; a league a test made has none, so this adds them. Test code only.
 */
import type { PrismaClient } from '@prisma/client';

type Db = Pick<PrismaClient,
  'sportLeaguePhase' | 'sportLeaguePhaseSlot' | 'sportLeaguePhaseSlotProviderMapping' | 'sportLeagueSeasonPhase'
  | 'sportLeagueSeasonPhaseSlot' | 'contestConfigTemplate' | 'contestConfigTemplateSlot'>;

let definitionCount = 0;

/**
 * The key of the template a test lists its synced slots on. A league with a template is kept as
 * reference data, so the integration cleanup deletes these first.
 */
export const COVERING_TEMPLATE_KEY = 'sync-slot-cover';

/**
 * A slot definition of the league mapped by the PROVIDER_CODE `code` at its provider mapping,
 * played by one synced Season slot in each of `seasonIds`, and listed by an active contest template
 * unless `covered` is false. Answers the Season slot ids in the order of `seasonIds`.
 */
export async function syncSlotsFor(
  prisma: Db,
  input: { sportLeagueId: string; sportLeagueProviderMappingId: string; code: string; seasonIds: readonly string[]; covered?: boolean },
): Promise<string[]> {
  const { sportLeagueId } = input;
  const phase = await prisma.sportLeaguePhase.upsert({
    where: { sportLeagueId_phase: { sportLeagueId, phase: 'REGULAR' } },
    create: { sportLeagueId, phase: 'REGULAR', isSynced: true },
    update: {},
    select: { id: true },
  });
  const definition = await prisma.sportLeaguePhaseSlot.create({
    data: {
      sportLeagueId,
      sportLeaguePhaseId: phase.id,
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
  await prisma.sportLeaguePhaseSlotProviderMapping.create({
    data: {
      sportLeagueId,
      sportLeaguePhaseSlotId: definition.id,
      sportLeagueProviderMappingId: input.sportLeagueProviderMappingId,
      matchType: 'PROVIDER_CODE',
      providerValue: input.code,
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
    await prisma.contestConfigTemplateSlot.create({ data: { sportLeagueId, templateId: template.id, sportLeaguePhaseSlotId: definition.id } });
  }
  const ids: string[] = [];
  for (const sportLeagueSeasonId of input.seasonIds) {
    const seasonPhase = await prisma.sportLeagueSeasonPhase.upsert({
      where: { sportLeagueSeasonId_sportLeaguePhaseId: { sportLeagueSeasonId, sportLeaguePhaseId: phase.id } },
      create: { sportLeagueId, sportLeagueSeasonId, sportLeaguePhaseId: phase.id },
      update: {},
      select: { id: true },
    });
    ids.push((await prisma.sportLeagueSeasonPhaseSlot.create({
      data: {
        sportLeagueId, sportLeagueSeasonId, sportLeagueSeasonPhaseId: seasonPhase.id, sportLeaguePhaseSlotId: definition.id,
        seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED',
      },
      select: { id: true },
    })).id);
  }
  return ids;
}
