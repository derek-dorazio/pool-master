/**
 * Writes many field rows' standings in a fixed number of statements (#1252). Prisma has no
 * update of many rows to different values, and a standing is pointed at only by its own golf
 * row, so the standings named are read, deleted with their golf rows, and inserted again with
 * the change applied. Each keeps its id, its creation time and every column the change leaves
 * alone, and a golf row the change does not touch is put back as it was; a field row with no
 * standing yet gets one.
 */

import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { StandingRankWrite } from '@poolmaster/shared/db';

type StandingColumns = Pick<
  Prisma.SportEventParticipantStandingUncheckedCreateInput,
  'position' | 'displayPosition' | 'status' | 'asOf' | 'currentRound'
>;
type GolfStandingColumns = Pick<
  Prisma.SportEventParticipantGolfStandingUncheckedCreateInput,
  'eventScoreToPar' | 'eventStrokes' | 'currentRoundThru'
>;
type StandingWithGolf = Prisma.SportEventParticipantStandingGetPayload<{ include: { golf: true } }>;

/** One field row's standing change: the core columns it sets, and its golf totals when it has them. */
export interface StandingRewrite {
  sportEventParticipantId: string;
  standing: Partial<StandingColumns>;
  golf?: GolfStandingColumns;
}

/**
 * Runs inside the caller's transaction: five statements at most, whatever the number of rows.
 * Answers each field row's standing as written, golf row included, in the order first named.
 */
export async function rewriteStandings(tx: Prisma.TransactionClient, rewrites: readonly StandingRewrite[]): Promise<StandingWithGolf[]> {
  // A row changed twice keeps the later change, as two upserts in a row would leave it.
  const rewriteById = new Map<string, StandingRewrite>();
  for (const rewrite of rewrites) {
    const earlier = rewriteById.get(rewrite.sportEventParticipantId);
    rewriteById.set(rewrite.sportEventParticipantId, {
      sportEventParticipantId: rewrite.sportEventParticipantId,
      standing: { ...earlier?.standing, ...rewrite.standing },
      golf: rewrite.golf ?? earlier?.golf,
    });
  }
  if (rewriteById.size === 0) return [];
  const existing = await tx.sportEventParticipantStanding.findMany({
    where: { sportEventParticipantId: { in: [...rewriteById.keys()] } },
    include: { golf: true },
  });
  return writeStandings(tx, existing, [...rewriteById.values()]);
}

/**
 * Re-ranks standings named by their own ids, in the caller's transaction: four statements at
 * most, whatever the number of rows. A standing that does not exist is an error, as an update
 * of a missing row is.
 */
export async function rewriteStandingRanks(tx: Prisma.TransactionClient, ranks: readonly StandingRankWrite[]): Promise<void> {
  if (ranks.length === 0) return;
  const existing = await tx.sportEventParticipantStanding.findMany({
    where: { id: { in: ranks.map((rank) => rank.standingId) } },
    include: { golf: true },
  });
  const fieldRowIdByStandingId = new Map(existing.map((row) => [row.id, row.sportEventParticipantId]));
  const rewriteById = new Map<string, StandingRewrite>();
  for (const rank of ranks) {
    const sportEventParticipantId = fieldRowIdByStandingId.get(rank.standingId);
    if (sportEventParticipantId === undefined) throw new Error(`No standing ${rank.standingId} to rank.`);
    rewriteById.set(sportEventParticipantId, {
      sportEventParticipantId,
      standing: { position: rank.position, displayPosition: rank.displayPosition },
    });
  }
  await writeStandings(tx, existing, [...rewriteById.values()]);
}

/** Deletes `existing` with its golf rows and inserts every rewrite's standing, one per field row. */
async function writeStandings(
  tx: Prisma.TransactionClient,
  existing: readonly StandingWithGolf[],
  rewrites: readonly StandingRewrite[],
): Promise<StandingWithGolf[]> {
  const existingById = new Map(existing.map((row) => [row.sportEventParticipantId, row]));
  const golfIds = existing.flatMap((row) => (row.golf ? [row.golf.id] : []));
  if (golfIds.length > 0) {
    await tx.sportEventParticipantGolfStanding.deleteMany({ where: { id: { in: golfIds } } });
  }
  if (existing.length > 0) {
    await tx.sportEventParticipantStanding.deleteMany({ where: { id: { in: existing.map((row) => row.id) } } });
  }

  const standings: Prisma.SportEventParticipantStandingCreateManyInput[] = [];
  const golfStandings: Prisma.SportEventParticipantGolfStandingCreateManyInput[] = [];
  for (const rewrite of rewrites) {
    const before = existingById.get(rewrite.sportEventParticipantId);
    const id = before?.id ?? randomUUID();
    standings.push({
      ...(before && {
        createdAt: before.createdAt,
        position: before.position,
        displayPosition: before.displayPosition,
        status: before.status,
        asOf: before.asOf,
        currentRound: before.currentRound,
      }),
      ...rewrite.standing,
      id,
      sportEventParticipantId: rewrite.sportEventParticipantId,
    });
    const beforeGolf = before?.golf ?? null;
    if (rewrite.golf) {
      golfStandings.push({
        ...(beforeGolf && { id: beforeGolf.id, createdAt: beforeGolf.createdAt }),
        ...rewrite.golf,
        standingId: id,
      });
    } else if (beforeGolf) {
      // A golf row the change leaves alone goes back exactly as it was, its update time too.
      golfStandings.push(beforeGolf);
    }
  }
  const written = await tx.sportEventParticipantStanding.createManyAndReturn({ data: standings });
  const writtenGolf = golfStandings.length > 0
    ? await tx.sportEventParticipantGolfStanding.createManyAndReturn({ data: golfStandings })
    : [];
  const writtenById = new Map(written.map((row) => [row.id, row]));
  const golfByStandingId = new Map(writtenGolf.map((row) => [row.standingId, row]));
  return standings.map((standing) => {
    const row = writtenById.get(standing.id as string) as (typeof written)[number];
    return { ...row, golf: golfByStandingId.get(row.id) ?? null };
  });
}
