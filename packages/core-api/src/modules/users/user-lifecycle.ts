/**
 * Shared User lifecycle mechanics (#202 step 3.3).
 *
 * `admin/user-service.ts` and `account/service.ts` implemented the same User operations
 * twice, once per scope. The delete cascade was **byte-for-byte identical** in both — nine
 * statements across eight tables, for a destructive operation, so any divergence would mean
 * one path leaving orphans the other cleaned. The dependency-count guard was a near-copy,
 * and session revocation a third.
 *
 * This module owns those mechanics once. It deliberately owns the **mechanics only**, not
 * the guards: the two callers currently disagree about which guards apply, and reconciling
 * that changes behaviour, so it is a separate decision rather than something this
 * extraction settles silently. `assertNotLastRootAdmin` is exported so the callers that
 * lack it can adopt it.
 *
 * This lives in `modules/users/` rather than under `admin/` or `account/` because it
 * belongs to neither scope. A user is a user; who may act on one is a permission. Step 3.4
 * collapses the route pairs into this module.
 *
 * The cross-table cascade stays on Prisma rather than moving behind a repository port, and
 * that is the correct boundary: a port owns one aggregate, and this spans eight tables
 * inside one transaction. Reads and single-entity writes DO go through `UserRepository`.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

/** The subset of Prisma usable inside or outside a transaction. */
type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface UserDeleteDependencyCounts {
  leagueCount: number;
  squadMembershipCount: number;
  createdSquadCount: number;
}

export interface UserDeleteDependencyDetails {
  dependencyType: 'TEAM_OWNER' | 'TEAM_MEMBER' | 'LEAGUE_MEMBER';
  userId: string;
  team?: {
    id: string;
    name: string;
  };
  league?: {
    id: string;
    leagueCode: string;
    name: string;
  };
}

/**
 * Counts the league-scoped rows that block a hard delete.
 *
 * No `league.createdBy` count — #202 dropped that column, and every league creator holds a
 * COMMISSIONER `LeagueMembership`, which `leagueCount` already counts.
 */
export async function countUserDeleteDependencies(
  prisma: PrismaClient,
  userId: string,
): Promise<UserDeleteDependencyCounts> {
  const [leagueCount, squadMembershipCount, createdSquadCount] = await Promise.all([
    prisma.leagueMembership.count({ where: { userId } }),
    prisma.squadMembership.count({ where: { userId } }),
    prisma.squad.count({ where: { createdBy: userId } }),
  ]);
  return { leagueCount, squadMembershipCount, createdSquadCount };
}

export function hasUserDeleteDependencies(counts: UserDeleteDependencyCounts): boolean {
  return counts.leagueCount > 0
    || counts.squadMembershipCount > 0
    || counts.createdSquadCount > 0;
}

/**
 * Resolves the first blocking dependency into something a caller can show a human.
 *
 * Ordered most-specific first: owning a squad explains the block better than merely
 * belonging to a league.
 */
export async function findUserDeleteDependencyDetails(
  prisma: PrismaClient,
  userId: string,
  counts: UserDeleteDependencyCounts,
): Promise<UserDeleteDependencyDetails | undefined> {
  if (counts.createdSquadCount > 0) {
    const team = await prisma.squad.findFirst({
      where: { createdBy: userId },
      select: {
        id: true,
        name: true,
        league: { select: { id: true, leagueCode: true, name: true } },
      },
    });
    if (team) {
      return {
        dependencyType: 'TEAM_OWNER',
        userId,
        team: { id: team.id, name: team.name },
        league: team.league,
      };
    }
  }

  if (counts.squadMembershipCount > 0) {
    const membership = await prisma.squadMembership.findFirst({
      where: { userId },
      select: {
        squad: { select: { id: true, name: true } },
        league: { select: { id: true, leagueCode: true, name: true } },
      },
    });
    if (membership) {
      return {
        dependencyType: 'TEAM_MEMBER',
        userId,
        team: membership.squad,
        league: membership.league,
      };
    }
  }

  if (counts.leagueCount > 0) {
    const membership = await prisma.leagueMembership.findFirst({
      where: { userId },
      select: { league: { select: { id: true, leagueCode: true, name: true } } },
    });
    if (membership) {
      return {
        dependencyType: 'LEAGUE_MEMBER',
        userId,
        league: membership.league,
      };
    }
  }

  return undefined;
}

/**
 * Revokes every live refresh token for the user.
 *
 * Pass a transaction client when this must be atomic with the write that caused it —
 * disabling a user and leaving their sessions live is the failure this prevents.
 *
 * Returns how many were revoked, which the force-logout operation reports back.
 */
export async function revokeUserSessions(prisma: PrismaLike, userId: string): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Deletes the user and everything that references them, in one transaction.
 *
 * Takes a transaction client because partial completion would leave orphan rows pointing at
 * a deleted user. The eight tables here are those with a `userId`-shaped column and no
 * cascade in the schema; league- and squad-scoped rows are NOT among them, which is why the
 * dependency guard above must run first and block.
 */
export async function deleteUserCascade(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.refreshToken.deleteMany({ where: { userId } });
  await tx.notification.deleteMany({ where: { userId } });
  await tx.consentRecord.deleteMany({ where: { userId } });
  await tx.leagueInvitation.deleteMany({
    where: { OR: [{ invitedBy: userId }, { acceptedBy: userId }] },
  });
  await tx.commissionerAuditLog.deleteMany({ where: { actorId: userId } });
  await tx.adminAuditEntry.deleteMany({ where: { actorId: userId } });
  await tx.migrationRun.deleteMany({ where: { startedById: userId } });
  await tx.user.delete({ where: { id: userId } });
}

/**
 * True when this user is the only root admin left.
 *
 * The guard exists so a platform cannot be left with nobody able to administer it.
 * `admin/user-service.ts` applies it on disable and delete; the self-service equivalents in
 * `account/service.ts` do not, which is how the sole root admin can inactivate and then
 * delete their own account. Exported here so both paths can use one implementation.
 */
export async function isLastRootAdmin(prisma: PrismaClient, userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isRootAdmin: true },
  });
  if (!user?.isRootAdmin) {
    return false;
  }
  const rootAdminCount = await prisma.user.count({ where: { isRootAdmin: true } });
  return rootAdminCount <= 1;
}
