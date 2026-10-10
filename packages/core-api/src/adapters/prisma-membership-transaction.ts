import type { PrismaClient } from '@prisma/client';
import type { MembershipRepositories, MembershipTransaction } from '@poolmaster/shared/db';
import { PrismaLeagueMembershipRepository } from './prisma-league-membership-repository';
import { PrismaSquadMembershipRepository } from './prisma-squad-membership-repository';
import { PrismaSquadOwnerInvitationRepository } from './prisma-squad-owner-invitation-repository';
import { PrismaSquadRepository } from './prisma-squad-repository';

/** Binds the membership repositories to one Prisma interactive transaction per `run`. */
export class PrismaMembershipTransaction implements MembershipTransaction {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>(work: (repos: MembershipRepositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => work({
      leagueMemberships: new PrismaLeagueMembershipRepository(tx),
      squads: new PrismaSquadRepository(tx),
      squadMemberships: new PrismaSquadMembershipRepository(tx),
      squadOwnerInvitations: new PrismaSquadOwnerInvitationRepository(tx),
    }));
  }
}
