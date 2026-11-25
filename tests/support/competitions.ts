/**
 * Competition fixtures (league model slice 6b, #2153): a slot definition sits in a competition of
 * its league's phase, and a Season slot in that competition's Season competition. A migration's
 * league has them; a league a test made has none, so the builders add them here. Test code only.
 */
import type { PrismaClient } from '@prisma/client';
import type { LeaguePhase } from '@poolmaster/shared/domain';

type LeagueDb = Pick<PrismaClient, 'sportLeaguePhase' | 'sportLeagueCompetition'>;
type SeasonDb = Pick<PrismaClient, 'sportLeagueSeasonPhase' | 'sportLeagueSeasonCompetition'>;

/** A league's competition and the phase it is in. */
export interface TestCompetition {
  phaseId: string;
  competitionId: string;
}

/**
 * The league's competition of `code` in `phase`, made with the phase when either is missing. With
 * no code, the phase's first competition, or one made with the phase value as its code (as the
 * migration gave every phase's first competition). The order index defaults to 1.
 */
export async function competitionFor(
  prisma: LeagueDb,
  input: { sportLeagueId: string; phase: LeaguePhase; code?: string; orderIndex?: number; isSynced?: boolean },
): Promise<TestCompetition> {
  const { sportLeagueId, phase } = input;
  // createMany with skipDuplicates, then a read: two first uses can race safely.
  await prisma.sportLeaguePhase.createMany({ data: [{ sportLeagueId, phase, isSynced: input.isSynced ?? true }], skipDuplicates: true });
  const phaseRow = await prisma.sportLeaguePhase.findUniqueOrThrow({ where: { sportLeagueId_phase: { sportLeagueId, phase } }, select: { id: true } });
  if (input.code === undefined) {
    // No code named: the phase's first competition, as a migration's league has (NCAA football's CFP).
    const first = await prisma.sportLeagueCompetition.findFirst({ where: { sportLeaguePhaseId: phaseRow.id }, orderBy: { orderIndex: 'asc' }, select: { id: true } });
    if (first !== null) return { phaseId: phaseRow.id, competitionId: first.id };
  }
  const code = input.code ?? phase;
  await prisma.sportLeagueCompetition.createMany({
    data: [{ sportLeagueId, sportLeaguePhaseId: phaseRow.id, code, orderIndex: input.orderIndex ?? 1 }],
    skipDuplicates: true,
  });
  const competition = await prisma.sportLeagueCompetition.findUniqueOrThrow({ where: { sportLeagueId_code: { sportLeagueId, code } }, select: { id: true } });
  return { phaseId: phaseRow.id, competitionId: competition.id };
}

/** The Season's competition of `competition`, made with its Season phase when either is missing. Answers its id. */
export async function seasonCompetitionFor(
  prisma: SeasonDb,
  input: { sportLeagueId: string; sportLeagueSeasonId: string; competition: TestCompetition },
): Promise<string> {
  const { sportLeagueId, sportLeagueSeasonId, competition } = input;
  await prisma.sportLeagueSeasonPhase.createMany({
    data: [{ sportLeagueId, sportLeagueSeasonId, sportLeaguePhaseId: competition.phaseId }],
    skipDuplicates: true,
  });
  await prisma.sportLeagueSeasonCompetition.createMany({
    data: [{ sportLeagueId, sportLeagueSeasonId, sportLeagueCompetitionId: competition.competitionId }],
    skipDuplicates: true,
  });
  const seasonCompetition = await prisma.sportLeagueSeasonCompetition.findUniqueOrThrow({
    where: { sportLeagueSeasonId_sportLeagueCompetitionId: { sportLeagueSeasonId, sportLeagueCompetitionId: competition.competitionId } },
    select: { id: true },
  });
  return seasonCompetition.id;
}
