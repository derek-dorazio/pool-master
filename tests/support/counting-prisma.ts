import type { PrismaClient } from '@prisma/client';

/**
 * `client` with every model operation counted as `Model.operation`, those made inside a
 * transaction included, and the rows each operation returned (a single row counts as one).
 * Integration tests use it to show how many queries a read or write makes.
 */
export function countingPrisma(client: PrismaClient) {
  const counts = new Map<string, number>();
  const rows = new Map<string, number>();
  const counted = client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const key = `${model}.${operation}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          const result: unknown = await query(args);
          if (Array.isArray(result)) rows.set(key, (rows.get(key) ?? 0) + result.length);
          else if (result) rows.set(key, (rows.get(key) ?? 0) + 1);
          return result;
        },
      },
    },
  });
  // The extended client runs every query the plain one does; the code under test takes the plain type.
  return {
    prisma: counted as unknown as PrismaClient,
    count: (key: string) => counts.get(key) ?? 0,
    rows: (key: string) => rows.get(key) ?? 0,
    /** Every operation counted so far. */
    total: () => [...counts.values()].reduce((sum, count) => sum + count, 0),
    operations: () => [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}
