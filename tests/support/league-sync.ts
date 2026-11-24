import type { PrismaClient } from '@prisma/client';
import { ProviderCode, providerSourceIdOf, type SportLeagueSeasonSpan } from '@poolmaster/shared/domain';

/**
 * The provider id a league synced by `syncLeagueTo` reads as its sync provider, and its events
 * carry: BALLDONTLIE's adapter id, the only provider with a row (#1997).
 */
export const SYNCED_PROVIDER_ID = providerSourceIdOf(ProviderCode.BALLDONTLIE);

/**
 * Turns a test sport league's event sync on (#1997): maps it to one of the BALLDONTLIE provider
 * leagues the migration seeds (by its code, `pga`) and selects that mapping, as the league
 * settings Save does. Returns the mapping's id.
 */
export async function syncLeagueTo(
  prisma: Pick<PrismaClient, 'providerLeague' | 'sportLeagueProviderMapping' | 'sportLeague'>,
  sportLeagueId: string,
  providerLeagueCode: string,
): Promise<string> {
  const providerLeague = await prisma.providerLeague.findFirstOrThrow({
    where: { code: providerLeagueCode, provider: { code: ProviderCode.BALLDONTLIE } },
    select: { id: true },
  });
  const mapping = await prisma.sportLeagueProviderMapping.create({
    data: { sportLeagueId, providerLeagueId: providerLeague.id },
    select: { id: true },
  });
  await prisma.sportLeague.update({ where: { id: sportLeagueId }, data: { selectedProviderMappingId: mapping.id } });
  return mapping.id;
}

/**
 * Gives a synced test league the Seasons a migration would (#2003): one per `championshipYears`,
 * each mapped to the provider's own id for it (BALLDONTLIE names a season by its year), the first
 * made current, as the daily recompute would. Returns the Season ids in the order asked.
 */
export async function syncSeasonsTo(
  prisma: Pick<PrismaClient, 'sportLeagueSeason' | 'sportLeagueSeasonProviderMapping' | 'sportLeague'>,
  sportLeagueId: string,
  sportLeagueProviderMappingId: string,
  championshipYears: readonly number[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const championshipYear of championshipYears) {
    const { id } = await prisma.sportLeagueSeason.create({
      data: {
        sportLeagueId,
        championshipYear,
        name: String(championshipYear),
        startsAt: new Date(Date.UTC(championshipYear, 0, 1)),
        endsAt: new Date(Date.UTC(championshipYear + 1, 0, 1) - 1),
      },
      select: { id: true },
    });
    await prisma.sportLeagueSeasonProviderMapping.create({
      data: { sportLeagueId, sportLeagueSeasonId: id, sportLeagueProviderMappingId, providerSeasonId: String(championshipYear) },
    });
    ids.push(id);
  }
  if (ids.length > 0) await prisma.sportLeague.update({ where: { id: sportLeagueId }, data: { currentSeasonId: ids[0] } });
  return ids;
}

/** A sport league's first Season, for a test that makes one through the repository: 2026, named for its year. */
export const FIRST_SEASON_2026: SportLeagueSeasonSpan = {
  name: '2026',
  championshipYear: 2026,
  startsAt: new Date('2026-01-01T00:00:00.000Z'),
  endsAt: new Date('2026-12-31T23:59:59.999Z'),
};
