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

/**
 * Takes one entry's row lock for the rest of the transaction (#1259). A roster pick change takes
 * it before it reads the entry's picks, so two changes to one entry run one after the other and
 * the second decides on what the first wrote: a full roster is never overfilled, and a repeated
 * pick of one golfer finds the first instead of tripping the one-pick-per-golfer index.
 */
export async function lockContestEntryRow(tx: Prisma.TransactionClient, entryId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "contest_entries" WHERE id = ${entryId}::uuid FOR UPDATE`;
}

/**
 * Takes the row locks of the contests under `contestIds` still in DRAFT (#1195), in id order and
 * in one statement, and resolves to their ids. A contest opened before its lock was taken is left
 * out, and one being opened meanwhile is waited for and then left out, so a caller deleting drafts
 * deletes only contests that are drafts until it commits.
 */
export async function lockDraftContestRows(tx: Prisma.TransactionClient, contestIds: readonly string[]): Promise<string[]> {
  if (contestIds.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM "contests"
    WHERE id = ANY(${[...contestIds]}::uuid[]) AND status = 'DRAFT'
    ORDER BY id
    FOR UPDATE`;
  return rows.map((row) => row.id);
}
