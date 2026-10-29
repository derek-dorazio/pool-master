import type {
  PrismaClient,
  Prisma,
  User as PrismaUser,
  UserAuthProvider as PrismaUserAuthProvider,
  UserTimeFormat as PrismaUserTimeFormat,
} from '@prisma/client';
import type { UserRepository, UserSearchFilters, UserUpdate } from '@poolmaster/shared/db';
import { AuthProvider, LeagueMembershipStatus, TimeFormat, type User } from '@poolmaster/shared/domain';

/**
 * Prisma adapter for `UserRepository`.
 *
 * **The port existed with no implementation.** It has been declared in
 * `packages/shared/db/ports.ts` and re-exported from the barrel since early on, with zero
 * adapters and zero consumers — so every user query in the codebase went straight to
 * `prisma.user`, and from there to a hand-rolled result shape. `admin/user-service.ts`
 * accumulated 36 raw calls that way and `account/service.ts` 26 (#202, §2y, §15).
 *
 * Note the enum mapping below is real work, not a cast. The Prisma client surfaces enum
 * MEMBER names (`'EMAIL'`, `'TWELVE_HOUR'`) while the domain enums hold the mapped
 * database values (`'email'`, `'12H'`), so the two differ at the type level. Three copies
 * of this mapping exist today — here, in `admin/user-service.ts` and in
 * `account.mapper.ts`. This is the row→domain boundary, so this is where it belongs; the
 * service copies go when their callers move onto the port.
 */
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? mapToUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? mapToUser(row) : null;
  }

  async findAll(filters: UserSearchFilters = {}): Promise<User[]> {
    // Not paged — §16. Narrowing is the filter's job; the caller gets the whole result.
    const rows = await this.prisma.user.findMany({
      where: buildUserWhere(filters),
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapToUser);
  }

  async findActiveByLeague(leagueId: string): Promise<User[]> {
    // The league join IS the scope (A4 + A6) — there is no way to call this unscoped.
    const rows = await this.prisma.user.findMany({
      where: { memberships: { some: { leagueId, status: LeagueMembershipStatus.ACTIVE } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return rows.map(mapToUser);
  }

  async findByIdentifier(identifier: string): Promise<User | null> {
    // Each column is @unique on its own, so up to two rows can match: one by email, one by
    // username. The email holder wins (#1028).
    const rows = await this.prisma.user.findMany({
      where: { OR: [{ email: identifier }, { username: identifier }] },
      take: 2,
    });
    const row = rows.find((candidate) => candidate.email === identifier) ?? rows.at(0);
    return row ? mapToUser(row) : null;
  }

  async findHolderOtherThan(identifier: string, exceptUserId: string): Promise<User | null> {
    const row = await this.prisma.user.findFirst({
      where: { id: { not: exceptUserId }, OR: [{ email: identifier }, { username: identifier }] },
    });
    return row ? mapToUser(row) : null;
  }

  async countActiveRootAdmins(): Promise<number> {
    return this.prisma.user.count({ where: { isRootAdmin: true, isActive: true } });
  }

  /**
   * `credentials` is a second parameter rather than a field on `User` because the domain
   * `User` deliberately carries no `passwordHash` — it is a secret, and no caller that
   * reads a user should be handed one. Registration still has to set it, so the create
   * operation accepts it separately. Omit it for a provider-authenticated account.
   */
  async create(
    user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>,
    credentials?: { passwordHash?: string },
  ): Promise<User> {
    const row = await this.prisma.user.create({
      data: {
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        isRootAdmin: user.isRootAdmin ?? false,
        ...(credentials?.passwordHash !== undefined
          ? { passwordHash: credentials.passwordHash }
          : {}),
        ...(user.authProvider !== undefined
          ? { authProvider: toPrismaAuthProvider(user.authProvider) }
          : {}),
        ...(user.authId !== undefined ? { authId: user.authId } : {}),
        ...(user.timezone !== undefined ? { timezone: user.timezone } : {}),
        ...(user.locale !== undefined ? { locale: user.locale } : {}),
        ...(user.timeFormat !== undefined
          ? { timeFormat: toPrismaTimeFormat(user.timeFormat) }
          : {}),
      },
    });
    return mapToUser(row);
  }

  /**
   * A field left out is untouched; a nullable field set to `null` is cleared.
   *
   * The `=== null ? null : toPrisma…` arms are the point of `UserUpdate`. Mapping a `null`
   * through the enum `Record` would return `undefined`, which Prisma reads as "no change" —
   * so clearing a preference would have silently done nothing.
   */
  async update(id: string, updates: UserUpdate): Promise<User> {
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...(updates.email !== undefined && { email: updates.email }),
        ...(updates.username !== undefined && { username: updates.username }),
        ...(updates.firstName !== undefined && { firstName: updates.firstName }),
        ...(updates.lastName !== undefined && { lastName: updates.lastName }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.isRootAdmin !== undefined && { isRootAdmin: updates.isRootAdmin }),
        ...(updates.timezone !== undefined && { timezone: updates.timezone }),
        ...(updates.locale !== undefined && { locale: updates.locale }),
        ...(updates.timeFormat !== undefined && {
          timeFormat: updates.timeFormat === null ? null : toPrismaTimeFormat(updates.timeFormat),
        }),
      },
    });
    return mapToUser(row);
  }

}

/**
 * Every word of the search must match one of the user's text columns, so a full name ("Ali
 * Smith") finds the user whose first name holds one word and last name the other. Each word is
 * its own substring match, which the trigram indexes on those columns serve (#1180).
 */
function buildUserWhere(filters: UserSearchFilters): Prisma.UserWhereInput {
  const words = filters.search?.trim().split(/\s+/).filter((word) => word.length > 0) ?? [];
  return {
    ...(words.length > 0
      ? {
        AND: words.map((word) => ({
          OR: [
            { email: { contains: word, mode: 'insensitive' as const } },
            { username: { contains: word, mode: 'insensitive' as const } },
            { firstName: { contains: word, mode: 'insensitive' as const } },
            { lastName: { contains: word, mode: 'insensitive' as const } },
          ],
        })),
      }
      : {}),
    ...(typeof filters.isActive === 'boolean' ? { isActive: filters.isActive } : {}),
    ...(typeof filters.isRootAdmin === 'boolean' ? { isRootAdmin: filters.isRootAdmin } : {}),
  };
}

/**
 * Row → domain. `passwordHash` and `authId` are the two columns the canonical `User`
 * never carries; `authId` is on the domain type but is provider bookkeeping, so it is
 * mapped, and `passwordHash` is dropped here and nowhere else. A read that embeds users
 * through a relation (a squad's owners, #1165) omits `passwordHash` in the query and maps the
 * rest here, which is why the row type leaves it out.
 */
export function mapToUser(row: Omit<PrismaUser, 'passwordHash'>): User {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    isActive: row.isActive,
    isRootAdmin: row.isRootAdmin,
    authProvider: fromPrismaAuthProvider(row.authProvider),
    authId: row.authId ?? undefined,
    timezone: row.timezone ?? undefined,
    locale: row.locale ?? undefined,
    timeFormat: fromPrismaTimeFormat(row.timeFormat),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// The two directions are written as exhaustive Records rather than switches so that
// adding an enum member fails the build here instead of silently falling through
// (rules/model-change-rules.md, and the model-change skill's first failure mode).
const AUTH_PROVIDER_FROM_PRISMA: Record<PrismaUserAuthProvider, AuthProvider> = {
  EMAIL: AuthProvider.EMAIL,
  GOOGLE: AuthProvider.GOOGLE,
  APPLE: AuthProvider.APPLE,
};

const AUTH_PROVIDER_TO_PRISMA: Record<AuthProvider, PrismaUserAuthProvider> = {
  [AuthProvider.EMAIL]: 'EMAIL',
  [AuthProvider.GOOGLE]: 'GOOGLE',
  [AuthProvider.APPLE]: 'APPLE',
};

const TIME_FORMAT_FROM_PRISMA: Record<PrismaUserTimeFormat, TimeFormat> = {
  TWELVE_HOUR: TimeFormat.TWELVE_HOUR,
  TWENTY_FOUR_HOUR: TimeFormat.TWENTY_FOUR_HOUR,
};

const TIME_FORMAT_TO_PRISMA: Record<TimeFormat, PrismaUserTimeFormat> = {
  [TimeFormat.TWELVE_HOUR]: 'TWELVE_HOUR',
  [TimeFormat.TWENTY_FOUR_HOUR]: 'TWENTY_FOUR_HOUR',
};

function fromPrismaAuthProvider(value: PrismaUserAuthProvider | null): AuthProvider | undefined {
  return value === null ? undefined : AUTH_PROVIDER_FROM_PRISMA[value];
}

function toPrismaAuthProvider(value: AuthProvider): PrismaUserAuthProvider {
  return AUTH_PROVIDER_TO_PRISMA[value];
}

function fromPrismaTimeFormat(value: PrismaUserTimeFormat | null): TimeFormat | undefined {
  return value === null ? undefined : TIME_FORMAT_FROM_PRISMA[value];
}

function toPrismaTimeFormat(value: TimeFormat): PrismaUserTimeFormat {
  return TIME_FORMAT_TO_PRISMA[value];
}
