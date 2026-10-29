import type { Prisma } from '@prisma/client';

/**
 * Takes the member's row lock for the rest of the transaction (#1264). A refresh-token rotation
 * and a reuse revoke each take it first, so they run one after the other: a revoke sees the token
 * a rotation ahead of it inserted, and a rotation behind a revoke finds its token revoked.
 *
 * `FOR NO KEY UPDATE`, not `FOR UPDATE`: a row that references the member (a new refresh token,
 * a league membership) takes a key-share lock on it, which this does not block.
 */
export async function lockMemberRow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
}
