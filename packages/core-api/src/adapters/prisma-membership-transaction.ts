import type { PrismaClient } from '@prisma/client';
import type { MembershipRepositories, MembershipTransaction } from '@poolmaster/shared/db';
import { leagueMembershipCache, type LeagueMembershipCache } from '../core/league-membership-cache';
import { forgettingReads, ReadMemoKey } from '../core/request-read-memo';
import { PrismaLeagueMembershipRepository } from './prisma-league-membership-repository';
import { PrismaSquadMembershipRepository } from './prisma-squad-membership-repository';
import { PrismaSquadOwnerInvitationRepository } from './prisma-squad-owner-invitation-repository';
import { PrismaSquadRepository } from './prisma-squad-repository';

/**
 * Binds the membership repositories to one Prisma interactive transaction per `run`. The
 * request's remembered league and team memberships, and teams, are forgotten again once it has
 * committed (#1176, #1200, #1355): a read made during the transaction, outside it, saw the rows
 * before the write. The task's league membership cache (#1438) keeps nothing read while the
 * transaction runs, so a read of the rows before it committed is not kept; the league
 * memberships it writes are forgotten there as each is written.
 */
export class PrismaMembershipTransaction implements MembershipTransaction {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: LeagueMembershipCache = leagueMembershipCache,
  ) {}

  async run<T>(work: (repos: MembershipRepositories) => Promise<T>): Promise<T> {
    const run = () => this.cache.writing(() => this.prisma.$transaction(async (tx) => work({
      leagueMemberships: new PrismaLeagueMembershipRepository(tx, this.cache),
      squads: new PrismaSquadRepository(tx),
      squadMemberships: new PrismaSquadMembershipRepository(tx),
      squadOwnerInvitations: new PrismaSquadOwnerInvitationRepository(tx),
    })));
    return forgettingReads([ReadMemoKey.leagueMembership, ReadMemoKey.squad, ReadMemoKey.squadMembership], run);
  }
}
