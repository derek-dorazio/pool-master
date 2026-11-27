/**
 * The events' FIELD matches (#2008): a golf round or a race, every competitor a side. They are read
 * by their events first, so the side and result reads that follow filter on match ids an index
 * leads on, rather than joining every side result to its slot's definition.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { FIELD_MATCH_WHERE } from './season-slot-select';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The ids of the events' FIELD matches, in one statement. An event with none (every head-to-head
 * event) costs its field reads nothing further.
 */
export async function readFieldMatchIds(db: Db, sportEventIds: readonly string[]): Promise<string[]> {
  if (sportEventIds.length === 0) return [];
  const rows = await db.sportEventRoundMatch.findMany({
    where: { sportEventId: { in: [...sportEventIds] }, ...FIELD_MATCH_WHERE },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
