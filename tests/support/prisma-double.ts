import type { PrismaClient } from '@prisma/client';

/**
 * Hands a partial Prisma double to a constructor that takes a `PrismaClient` (#345 Phase 2 PR 2).
 *
 * A service that still reads Prisma directly needs a `PrismaClient`, and a test double is
 * only ever the two or three delegates that service touches. The old idiom was
 * `return { user: { findUnique: jest.fn() } } as any` in the factory — which made the
 * DOUBLE `any` too, so every `prisma.user.findUnique.mockResolvedValue(...)` in the test
 * was an untyped call and a misspelt delegate compiled.
 *
 * Keep the factory's object literal uncast, so the test reads its mocks through their real
 * types, and cross into `PrismaClient` here, once, at the constructor:
 *
 *     const prisma = createPrismaMock();
 *     prisma.refreshToken.findUnique.mockResolvedValue(row);   // typed
 *     const service = new AuthService(users, asPrismaClient(prisma));
 *
 * This is the one assertion a partial Prisma double needs; it is not a licence to cast a
 * port double. Ports have whole-interface fakes in `repo-fakes.ts` and need no cast at all.
 */
export function asPrismaClient(double: object): PrismaClient {
  return double as PrismaClient;
}
