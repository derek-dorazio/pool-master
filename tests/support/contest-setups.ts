/**
 * Every contest setup is one sport league's (#1825), seeded by the migration that adds the league.
 * A test that builds a sport league of its own through the admin API gets none, so it copies a
 * seeded league's setups onto it, as that migration would. The test deletes them before it
 * deletes the league: a league with setups cannot be deleted.
 */
import type { PrismaClient } from '@prisma/client';

export async function copyContestSetups(
  db: Pick<PrismaClient, 'sportLeague' | 'contestConfigTemplate'>,
  input: { fromSportLeagueName: string; toSportLeagueId: string },
): Promise<void> {
  const to = await db.sportLeague.findUniqueOrThrow({ where: { id: input.toSportLeagueId }, select: { sportId: true } });
  const from = await db.sportLeague.findUniqueOrThrow({
    where: { sportId_name: { sportId: to.sportId, name: input.fromSportLeagueName } },
    select: { contestConfigTemplates: true },
  });
  await db.contestConfigTemplate.createMany({
    data: from.contestConfigTemplates.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, configJson, ...template }) => ({
      ...template,
      configJson: configJson ?? {},
      sportLeagueId: input.toSportLeagueId,
    })),
  });
}

/** A seeded sport league's id by its name: the PGA TOUR, whose setups a golf test creates from. */
export async function seededSportLeagueId(
  db: Pick<PrismaClient, 'sportLeague'>,
  sport: 'GOLF' | 'HORSE_RACING',
  name: string,
): Promise<string> {
  return (await db.sportLeague.findFirstOrThrow({ where: { name, sport: { sport } }, select: { id: true } })).id;
}
