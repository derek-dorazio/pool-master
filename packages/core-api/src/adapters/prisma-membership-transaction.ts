import type { PrismaClient } from '@prisma/client';
import type { MembershipRepositories, MembershipTransaction } from '@poolmaster/shared/db';
import { forgettingReads, ReadMemoKey } from '../core/request-read-memo';
import { PrismaLeagueMembershipRepository } from './prisma-league-membership-repository';
import { PrismaSquadMembershipRepository } from './prisma-squad-membership-repository';
import { PrismaSquadOwnerInvitationRepository } from './prisma-squad-owner-invitation-repository';
import { PrismaSquadRepository } from './prisma-squad-repository';

/**
 * Binds the membership repositories to one Prisma interactive transaction per `run`. The
 * request's remembered league and team memberships, and teams, are forgotten again once it has
 * committed (#1176, #1200, #1355): a read made during the transaction, outside it, saw the rows
 * before the write.
 */
export class PrismaMembershipTransaction implements MembershipTransaction {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>(work: (repos: MembershipRepositories) => Promise<T>): Promise<T> {
    const run = () => this.prisma.$transaction(async (tx) => work({
      leagueMemberships: new PrismaLeagueMembershipRepository(tx),
      squads: new PrismaSquadRepository(tx),
      squadMemberships: new PrismaSquadMembershipRepository(tx),
      squadOwnerInvitations: new PrismaSquadOwnerInvitationRepository(tx),
    }));
    return forgettingReads([ReadMemoKey.leagueMembership, ReadMemoKey.squad, ReadMemoKey.squadMembership], run);
  }
}
