/**
 * Writes many field rows' standings in a fixed number of statements (#1252). Prisma has no
 * update of many rows to different values, and nothing points at a standing, so the standings
 * named are read, deleted, and inserted again with the change applied. Each keeps its id, its
 * creation time and every column the change leaves alone; a field row with no standing yet gets
 * one.
 */

import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type StandingColumns = Pick<
  Prisma.SportEventParticipantStandingUncheckedCreateInput,
  'position' | 'displayPosition' | 'status' | 'asOf' | 'total' | 'scoreToPar'
>;
type StandingRow = Prisma.SportEventParticipantStandingGetPayload<object>;

/** One field row's standing change: the columns it sets. */
export interface StandingRewrite {
  sportEventParticipantId: string;
  standing: Partial<StandingColumns>;
}

/**
 * Runs inside the caller's transaction: three statements at most, whatever the number of rows.
 * Answers each field row's standing as written, in the order first named.
 */
export async function rewriteStandings(tx: Prisma.TransactionClient, rewrites: readonly StandingRewrite[]): Promise<StandingRow[]> {
  // A row changed twice keeps the later change, as two upserts in a row would leave it.
  const rewriteById = new Map<string, StandingRewrite>();
  for (const rewrite of rewrites) {
    const earlier = rewriteById.get(rewrite.sportEventParticipantId);
    rewriteById.set(rewrite.sportEventParticipantId, {
      sportEventParticipantId: rewrite.sportEventParticipantId,
      standing: { ...earlier?.standing, ...rewrite.standing },
    });
  }
  if (rewriteById.size === 0) return [];
  const existing = await tx.sportEventParticipantStanding.findMany({
    where: { sportEventParticipantId: { in: [...rewriteById.keys()] } },
  });
  const existingById = new Map(existing.map((row) => [row.sportEventParticipantId, row]));
  if (existing.length > 0) {
    await tx.sportEventParticipantStanding.deleteMany({ where: { id: { in: existing.map((row) => row.id) } } });
  }

  const standingIds: string[] = [];
  const standings: Prisma.SportEventParticipantStandingCreateManyInput[] = [];
  for (const rewrite of rewriteById.values()) {
    const before = existingById.get(rewrite.sportEventParticipantId);
    const id = before?.id ?? randomUUID();
    standingIds.push(id);
    standings.push({
      ...(before && {
        createdAt: before.createdAt,
        position: before.position,
        displayPosition: before.displayPosition,
        status: before.status,
        asOf: before.asOf,
        total: before.total,
        scoreToPar: before.scoreToPar,
      }),
      ...rewrite.standing,
      id,
      sportEventParticipantId: rewrite.sportEventParticipantId,
    });
  }
  const written = await tx.sportEventParticipantStanding.createManyAndReturn({ data: standings });
  const writtenById = new Map(written.map((row) => [row.id, row]));
  return standingIds.map((id) => {
    const row = writtenById.get(id);
    if (!row) throw new Error(`Standing ${id} was not written.`);
    return row;
  });
}
