import type { Prisma } from '@prisma/client';

/**
 * Takes the contest row lock for the rest of the transaction (#644). Recording a random draw and
 * creating or deleting an entry each take it first, so they run one after the other and the
 * second sees what the first committed: a draw sees the entry that came in ahead of it, and an
 * entry write sees the draw that closed the contest.
 */
export async function lockContestRow(tx: Prisma.TransactionClient, contestId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "contests" WHERE id = ${contestId}::uuid FOR UPDATE`;
}

/**
 * Takes several contests' row locks (#646), always in id order, so two writers that lock an
 * overlapping set of contests cannot each hold one the other is waiting for.
 */
export async function lockContestRows(tx: Prisma.TransactionClient, contestIds: Iterable<string>): Promise<void> {
  for (const contestId of [...new Set(contestIds)].sort()) {
    await lockContestRow(tx, contestId);
  }
}
