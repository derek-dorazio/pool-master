/**
 * Invitations module — non-league-scoped invitation acceptance.
 *
 * Users accepting an invite only have the code, not the league ID,
 * so this endpoint lives outside the /leagues/:id prefix.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  PrismaLeagueRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueInvitationRepository,
} from '../../adapters';
import { InvitationService } from '../leagues/invitation-service';
import { createInvitationHandlers } from '../leagues/invitation-handler';

export async function invitationsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const leagueRepo = new PrismaLeagueRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const invitationRepo = new PrismaLeagueInvitationRepository(prisma);

  const invitationService = new InvitationService(invitationRepo, membershipRepo, leagueRepo);
  const handlers = createInvitationHandlers(invitationService);

  fastify.post('/accept', {
    schema: {
      tags: ['Invitations'],
      summary: 'Accept a league invitation using an invite code',
      operationId: 'acceptInvitation',
      body: {
        type: 'object',
        required: ['inviteCode'],
        properties: {
          inviteCode: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: handlers.acceptInvitation,
  });
}
