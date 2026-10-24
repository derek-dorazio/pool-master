import type { FastifyInstance } from 'fastify';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/team-owner-invitations.dto';
// #217 — the register-and-accept route returns AuthResponse, so its module registers here too.
import '@poolmaster/shared/dto/auth.dto';
import {
  PrismaLeagueMembershipRepository,
  PrismaSquadMembershipRepository,
  PrismaMembershipTransaction,
  PrismaSquadOwnerInvitationRepository,
  PrismaSquadRepository,
  PrismaUserRepository,
} from '../../adapters';
import { getAppPrisma } from '../../core/prisma-context';
import type { MemberJoinedModuleOptions } from '../notifications/member-joined-notices';
import { readApplicationBaseUrl, type MailModuleOptions } from '../email';
import { createSquadOwnerInvitationHandlers } from '../squads/owner-invitation-handler';
import { SquadOwnerInvitationService } from '../squads/owner-invitation-service';
import { AuthService } from '../auth/auth-service';

export function teamInvitationsModule(fastify: FastifyInstance, opts: MailModuleOptions & MemberJoinedModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const invitationRepo = new PrismaSquadOwnerInvitationRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const userRepo = new PrismaUserRepository(prisma);
  const service = new SquadOwnerInvitationService({
    squadOwnerInvitations: invitationRepo,
    leagueMemberships: membershipRepo,
    squads: squadRepo,
    squadMemberships: squadMembershipRepo,
    users: userRepo,
    prisma,
    membershipTransaction: new PrismaMembershipTransaction(prisma),
    email: opts.email,
    memberJoined: opts.memberJoined,
    appBaseUrl: readApplicationBaseUrl(process.env),
    logger: fastify.log,
  });
  // #217 — this module is the only one that exposes register-and-accept, so it is the only one
  // that hands the handlers an AuthService.
  const handlers = createSquadOwnerInvitationHandlers(
    service,
    new AuthService(userRepo, prisma, fastify.log),
  );

  fastify.get('/:inviteCode', {
    schema: {
      tags: ['Squads'],
      summary: 'Preview a co-owner invitation by invite code',
      description:
        'Returns the minimal league and squad identity needed to render the public co-owner invitation flow before or after authentication.',
      operationId: 'getTeamOwnerInvitationPreview',
      response: {
        200: schemaRef('TeamOwnerInvitationPreviewResponse'),
        400: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    handler: handlers.getInvitationPreview,
  });

  fastify.post('/accept', {
    schema: {
      tags: ['Squads'],
      summary: 'Accept a co-owner invitation using an invite code',
      description:
        'Accepts a co-owner invitation for the authenticated user and provisions league membership plus squad ownership on the target squad. Only the account whose email the invitation was sent to may accept it (400 `SQUAD_OWNER_INVITATION_EMAIL_MISMATCH`). An inactive league refuses with 400 `LEAGUE_INACTIVE`, and a squad that has gone inactive since the invitation was sent refuses with 400 `SQUAD_INACTIVE`.',
      operationId: 'acceptTeamOwnerInvitation',
      body: schemaRef('AcceptTeamOwnerInvitationRequest'),
      response: {
        201: schemaRef('TeamOwnerInvitationResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    handler: handlers.acceptInvitation,
  });

  fastify.post('/register', {
    schema: {
      tags: ['Squads'],
      summary: 'Register a new account against a co-owner invitation and accept it',
      description:
        'Creates a PoolMaster account for an invited co-owner who does not have one yet, then joins them to the league and the invited squad — registration, league membership and squad ownership in a single request. Returns the new account with a session, so the invitee is signed in and lands on their squad.\n\nUnauthenticated by design: the caller has no account yet, which is why `acceptTeamOwnerInvitation` cannot serve them. When the invited email already belongs to a user, `createSquadOwnerInvitation` provisions them immediately and the invitation comes back ACCEPTED, so there is nothing to accept and this route returns 400 `SQUAD_OWNER_INVITATION_ACCOUNT_EXISTS`.\n\nThe account is created with the address the invitation was sent to; the request carries no email. A co-owner invitation grants league membership, so honouring an address supplied by the caller would let a forwarded invite link admit an unintended person. An inactive league refuses with 400 `LEAGUE_INACTIVE`, and a squad that has gone inactive since the invitation was sent refuses with 400 `SQUAD_INACTIVE`.',
      operationId: 'registerWithTeamOwnerInvitation',
      body: schemaRef('RegisterWithTeamOwnerInvitationRequest'),
      response: {
        201: schemaRef('AuthResponse'),
        400: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
      },
    },
    handler: handlers.registerAndAcceptInvitation,
  });
}
