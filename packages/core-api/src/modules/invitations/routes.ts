/**
 * Invitations module — non-league-scoped invitation preview and acceptance.
 *
 * Users accepting an invite only have the code, not the league ID,
 * so this endpoint lives outside the /leagues/:id prefix.
 */

import type { FastifyInstance } from 'fastify';
import { ErrorEnvelopeSchema, zodToJsonSchema } from '@poolmaster/shared/dto';
import {
  AcceptInvitationRequestSchema,
  InvitationPreviewResponseSchema,
  LeagueMembershipResponseSchema,
} from '@poolmaster/shared/dto/leagues.dto';
import {
  PrismaLeagueRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueInvitationRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
} from '../../adapters';
import { InvitationService } from '../leagues/invitation-service';
import { createInvitationHandlers } from '../leagues/invitation-handler';
import { getAppPrisma } from '../../core/prisma-context';

export async function invitationsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const leagueRepo = new PrismaLeagueRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const invitationRepo = new PrismaLeagueInvitationRepository(prisma);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);

  const invitationService = new InvitationService(
    invitationRepo,
    membershipRepo,
    leagueRepo,
    squadRepo,
    squadMembershipRepo,
    prisma,
  );
  const handlers = createInvitationHandlers(invitationService);

  fastify.get('/:inviteCode', {
    schema: {
      tags: ['Invitations'],
      summary: 'Preview a league invitation by invite code',
      description:
        'Returns the minimal league identity and invitation state needed to render the public `/invite/<inviteCode>` entry flow before or after authentication.',
      operationId: 'getInvitationPreview',
      response: {
        200: zodToJsonSchema(InvitationPreviewResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.getInvitationPreview,
  });

  fastify.post('/accept', {
    schema: {
      tags: ['Invitations'],
      summary: 'Accept a league invitation using an invite code',
      description:
        'Accepts an invitation for the authenticated user and creates or reactivates a MEMBER membership in the target league.',
      operationId: 'acceptInvitation',
      body: zodToJsonSchema(AcceptInvitationRequestSchema),
      response: {
        201: zodToJsonSchema(LeagueMembershipResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.acceptInvitation,
  });
}
