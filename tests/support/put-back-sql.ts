import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

/**
 * A comment that makes a raw statement's text new to Prisma's statement cache. A migration test
 * that puts an old enum type back inside a rolled-back transaction makes a new type each time, and
 * a statement prepared against the type a previous test made fails with "cache lookup failed for
 * type"; start each statement that casts to a put-back type with this.
 */
export function uncachedStatement(): Prisma.Sql {
  return Prisma.raw(`/* ${randomUUID()} */`);
}
