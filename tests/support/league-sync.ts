import type { PrismaClient } from '@prisma/client';
import { ProviderCode, providerSourceIdOf } from '@poolmaster/shared/domain';

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
