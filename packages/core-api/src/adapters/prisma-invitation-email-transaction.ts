import type { PrismaClient } from '@prisma/client';
import type { InvitationEmailRepositories, InvitationEmailTransaction } from '@poolmaster/shared/db';
import { recordEmailMessages } from './prisma-email-message-repository';
import { PrismaLeagueInvitationRepository } from './prisma-league-invitation-repository';

/** Binds the invitation write and its invite emails' outbox write to one Prisma transaction per `run` (#1357). */
export class PrismaInvitationEmailTransaction implements InvitationEmailTransaction {
  constructor(private readonly prisma: PrismaClient) {}

  run<T>(work: (repos: InvitationEmailRepositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => work({
      invitations: new PrismaLeagueInvitationRepository(tx),
      emails: { recordMany: (inputs) => recordEmailMessages(tx, inputs) },
    }));
  }
}
