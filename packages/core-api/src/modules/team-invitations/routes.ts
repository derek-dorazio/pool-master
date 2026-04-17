import type { FastifyInstance } from 'fastify';
import { ErrorEnvelopeSchema, zodToJsonSchema } from '@poolmaster/shared/dto';
import {
  AcceptTeamOwnerInvitationRequestSchema,
  TeamOwnerInvitationPreviewResponseSchema,
  TeamOwnerInvitationResponseSchema,
} from '@poolmaster/shared/dto';
import {
  PrismaLeagueMembershipRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadOwnerInvitationRepository,
  PrismaSquadRepository,
} from '../../adapters';
import { getAppPrisma } from '../../core/prisma-context';
import { createSquadOwnerInvitationHandlers } from '../squads/owner-invitation-handler';
import { SquadOwnerInvitationService } from '../squads/owner-invitation-service';

export async function teamInvitationsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const invitationRepo = new PrismaSquadOwnerInvitationRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const service = new SquadOwnerInvitationService(
    invitationRepo,
    membershipRepo,
    squadRepo,
    squadMembershipRepo,
    prisma,
  );
  const handlers = createSquadOwnerInvitationHandlers(service);

  fastify.get('/:inviteCode', {
    schema: {
      tags: ['Squads'],
      summary: 'Preview a team-owner invitation by invite code',
      description:
        'Returns the minimal league and team identity needed to render the public team-owner invitation flow before or after authentication.',
      operationId: 'getTeamOwnerInvitationPreview',
      response: {
        200: zodToJsonSchema(TeamOwnerInvitationPreviewResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.getInvitationPreview,
  });

  fastify.post('/accept', {
    schema: {
      tags: ['Squads'],
      summary: 'Accept a team-owner invitation using an invite code',
      description:
        'Accepts a team-owner invitation for the authenticated user and provisions league membership plus team ownership on the target team.',
      operationId: 'acceptTeamOwnerInvitation',
      body: zodToJsonSchema(AcceptTeamOwnerInvitationRequestSchema),
      response: {
        201: zodToJsonSchema(TeamOwnerInvitationResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.acceptInvitation,
  });
}
