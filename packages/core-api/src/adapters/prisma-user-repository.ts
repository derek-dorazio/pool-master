import type {
  PrismaClient,
  Prisma,
  User as PrismaUser,
  UserAuthProvider as PrismaUserAuthProvider,
  UserDateFormat as PrismaUserDateFormat,
  UserTimeFormat as PrismaUserTimeFormat,
} from '@prisma/client';
import type {
  PagedResult,
  PageRequest,
  UserRepository,
  UserSearchFilters,
} from '@poolmaster/shared/db';
import { AuthProvider, DateFormat, TimeFormat, type User } from '@poolmaster/shared/domain';

const DEFAULT_PAGE_SIZE = 25;

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

  async findAll(
    filters: UserSearchFilters = {},
    page: PageRequest = {},
  ): Promise<PagedResult<User>> {
    const where = buildUserWhere(filters);
    const pageNumber = Math.max(1, page.page ?? 1);
    const pageSize = Math.max(1, page.pageSize ?? DEFAULT_PAGE_SIZE);

    // One round trip for the page and one for the total — the envelope needs both, and
    // the caller cannot derive `total` from a page.
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items: rows.map(mapToUser), total };
  }

  async findByLeague(leagueId: string): Promise<User[]> {
    // The league join IS the scope (A4 + A6) — there is no way to call this unscoped.
    const rows = await this.prisma.user.findMany({
      where: { memberships: { some: { leagueId } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return rows.map(mapToUser);
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
        ...(user.dateFormat !== undefined
          ? { dateFormat: toPrismaDateFormat(user.dateFormat) }
          : {}),
      },
    });
    return mapToUser(row);
  }

  async update(id: string, updates: Partial<User>): Promise<User> {
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...(updates.email !== undefined && { email: updates.email }),
        ...(updates.username !== undefined && { username: updates.username }),
        ...(updates.firstName !== undefined && { firstName: updates.firstName }),
        ...(updates.lastName !== undefined && { lastName: updates.lastName }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.isRootAdmin !== undefined && { isRootAdmin: updates.isRootAdmin }),
        ...(updates.authProvider !== undefined && {
          authProvider: toPrismaAuthProvider(updates.authProvider),
        }),
        ...(updates.authId !== undefined && { authId: updates.authId }),
        ...(updates.timezone !== undefined && { timezone: updates.timezone }),
        ...(updates.locale !== undefined && { locale: updates.locale }),
        ...(updates.timeFormat !== undefined && {
          timeFormat: toPrismaTimeFormat(updates.timeFormat),
        }),
        ...(updates.dateFormat !== undefined && {
          dateFormat: toPrismaDateFormat(updates.dateFormat),
        }),
      },
    });
    return mapToUser(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }
}

function buildUserWhere(filters: UserSearchFilters): Prisma.UserWhereInput {
  const search = filters.search?.trim();
  return {
    ...(search
      ? {
        OR: [
          { email: { contains: search, mode: 'insensitive' as const } },
          { username: { contains: search, mode: 'insensitive' as const } },
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
        ],
      }
      : {}),
    ...(typeof filters.isActive === 'boolean' ? { isActive: filters.isActive } : {}),
  };
}

/**
 * Row → domain. `passwordHash` and `authId` are the two columns the canonical `User`
 * never carries; `authId` is on the domain type but is provider bookkeeping, so it is
 * mapped, and `passwordHash` is dropped here and nowhere else.
 */
function mapToUser(row: PrismaUser): User {
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
    dateFormat: fromPrismaDateFormat(row.dateFormat),
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

const DATE_FORMAT_FROM_PRISMA: Record<PrismaUserDateFormat, DateFormat> = {
  MDY: DateFormat.MDY,
  DMY: DateFormat.DMY,
  YMD: DateFormat.YMD,
};

const DATE_FORMAT_TO_PRISMA: Record<DateFormat, PrismaUserDateFormat> = {
  [DateFormat.MDY]: 'MDY',
  [DateFormat.DMY]: 'DMY',
  [DateFormat.YMD]: 'YMD',
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

function fromPrismaDateFormat(value: PrismaUserDateFormat | null): DateFormat | undefined {
  return value === null ? undefined : DATE_FORMAT_FROM_PRISMA[value];
}

function toPrismaDateFormat(value: DateFormat): PrismaUserDateFormat {
  return DATE_FORMAT_TO_PRISMA[value];
}
