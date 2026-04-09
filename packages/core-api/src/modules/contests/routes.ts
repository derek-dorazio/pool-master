/**
 * Contests module — registers contest CRUD routes under /api/v1/leagues/:id/contests
 * and standalone contest routes under /api/v1/contests.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { CommissionerPermission } from '@poolmaster/shared/domain';
import {
  AdjustContestScoreRequestSchema,
  CloseContestRequestSchema,
  ContestAuditLogResponseSchema,
  ContestEntryDeletionResponseSchema,
  ContestEntryListResponseSchema,
  ContestEntryResponseSchema,
  ContestListResponseSchema,
  ContestRecalculationResponseSchema,
  ContestResponseSchema,
  CreateContestRequestSchema,
  ExtendContestDeadlineRequestSchema,
  ExtendPickClockRequestSchema,
  MyContestEntryResponseSchema,
  PauseContestDraftRequestSchema,
  ReopenContestRequestSchema,
  SuccessSchema,
  UndoContestDraftSelectionRequestSchema,
  UpdateContestLockTimeRequestSchema,
  UpdateContestRequestSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import {
  PrismaContestRepository,
  PrismaContestConfigurationRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaContestEntryRepository,
  PrismaDraftSessionRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
} from '../../adapters';
import { requirePermission } from '../../core/require-permission';
import { ContestService } from './service';
import { OverrideService } from './override-service';
import { ContestScoringRecalculationService } from '../contest-scoring';
import { createContestHandlers } from './handler';
import { createOverrideHandlers } from './override-handler';

export async function contestsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const contestRepo = new PrismaContestRepository(prisma);
  const contestConfigurationRepo = new PrismaContestConfigurationRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const leagueRepo = new PrismaLeagueRepository(prisma);

  const contestService = new ContestService(
    contestRepo,
    contestConfigurationRepo,
    membershipRepo,
    leagueRepo,
    squadRepo,
    squadMembershipRepo,
    undefined,
    prisma,
  );
  const handlers = createContestHandlers(contestService);

  // --- League-scoped contest routes (under /api/v1/leagues/:id/contests) ---
  // Note: These are registered under the leagues prefix, so :id = leagueId

  fastify.get('/', {
    schema: {
      tags: ['Contests'],
      summary: 'List contests for a league',
      operationId: 'listContests',
      response: { 200: zodToJsonSchema(ContestListResponseSchema) },
    },
    handler: handlers.listContests,
  });

  fastify.post('/', {
    schema: {
      tags: ['Contests'],
      summary: 'Create a new contest in a league',
      operationId: 'createContest',
      body: zodToJsonSchema(CreateContestRequestSchema),
      response: {
        201: zodToJsonSchema(ContestResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requirePermission(membershipRepo, CommissionerPermission.CONTEST_CREATE),
    handler: handlers.createContest,
  });
}

/**
 * Standalone contest routes — registered at /api/v1/contests for
 * operations that use contestId rather than leagueId.
 */
export async function contestsByIdModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const contestRepo = new PrismaContestRepository(prisma);
  const contestConfigurationRepo = new PrismaContestConfigurationRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const leagueRepo = new PrismaLeagueRepository(prisma);
  const entryRepo = new PrismaContestEntryRepository(prisma);
  const draftSessionRepo = new PrismaDraftSessionRepository(prisma);

  const contestService = new ContestService(
    contestRepo,
    contestConfigurationRepo,
    membershipRepo,
    leagueRepo,
    squadRepo,
    squadMembershipRepo,
    entryRepo,
    prisma,
  );
  const overrideService = new OverrideService(
    contestRepo,
    draftSessionRepo,
    entryRepo,
    new ContestScoringRecalculationService(prisma),
  );
  const handlers = createContestHandlers(contestService);
  const overrides = createOverrideHandlers(overrideService);

  // --- Contest CRUD ---
  fastify.get('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Get a contest by ID',
      operationId: 'getContest',
      response: {
        200: zodToJsonSchema(ContestResponseSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.getContest,
  });

  fastify.get('/:contestId/entries', {
    schema: {
      tags: ['Contests'],
      summary: 'List contest entries',
      operationId: 'listContestEntries',
      response: {
        200: zodToJsonSchema(ContestEntryListResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.listEntries,
  });

  fastify.get('/:contestId/entries/me', {
    schema: {
      tags: ['Contests'],
      summary: 'Get the current user contest entry',
      operationId: 'getMyContestEntry',
      response: {
        200: zodToJsonSchema(MyContestEntryResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.getMyEntry,
  });

  fastify.post('/:contestId/entries/me', {
    schema: {
      tags: ['Contests'],
      summary: 'Create or return the current user contest entry',
      operationId: 'enterContest',
      response: {
        200: zodToJsonSchema(ContestEntryResponseSchema),
        201: zodToJsonSchema(ContestEntryResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.createMyEntry,
  });

  fastify.delete('/:contestId/entries/me', {
    schema: {
      tags: ['Contests'],
      summary: 'Delete the current user contest entry',
      operationId: 'leaveContest',
      response: {
        200: zodToJsonSchema(ContestEntryDeletionResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.deleteMyEntry,
  });

  fastify.put('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Update a contest',
      operationId: 'updateContest',
      body: zodToJsonSchema(UpdateContestRequestSchema),
      response: {
        200: zodToJsonSchema(ContestResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.updateContest,
  });

  fastify.delete('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Delete a contest',
      operationId: 'deleteContest',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.deleteContest,
  });

  // --- Draft Overrides ---
  fastify.post('/:contestId/draft/undo-pick', {
    schema: {
      tags: ['Contests'],
      summary: 'Undo a draft pick',
      operationId: 'undoContestDraftSelection',
      body: zodToJsonSchema(UndoContestDraftSelectionRequestSchema),
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: overrides.undoPick,
  });
  fastify.post('/:contestId/draft/pause', {
    schema: {
      tags: ['Contests'],
      summary: 'Pause an active draft (contest override)',
      operationId: 'pauseContestDraft',
      body: zodToJsonSchema(PauseContestDraftRequestSchema),
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: overrides.pauseDraft,
  });
  fastify.post('/:contestId/draft/resume', {
    schema: {
      tags: ['Contests'],
      summary: 'Resume a paused draft (contest override)',
      operationId: 'resumeContestDraft',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: overrides.resumeDraft,
  });
  fastify.post('/:contestId/draft/extend-clock', {
    schema: {
      tags: ['Contests'],
      summary: 'Extend the pick clock for the current drafter',
      operationId: 'extendPickClock',
      body: zodToJsonSchema(ExtendPickClockRequestSchema),
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: overrides.extendPickClock,
  });

  // --- Scoring Overrides ---
  fastify.post('/:contestId/scoring/adjust', {
    schema: {
      tags: ['Contests'],
      summary: 'Manually adjust an entry score',
      operationId: 'adjustScore',
      body: zodToJsonSchema(AdjustContestScoreRequestSchema),
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: overrides.adjustScore,
  });
  fastify.post('/:contestId/scoring/recalculate', {
    schema: {
      tags: ['Contests'],
      summary: 'Recalculate standings for a contest',
      operationId: 'recalculateStandings',
      response: { 200: zodToJsonSchema(ContestRecalculationResponseSchema) },
    },
    handler: overrides.recalculateStandings,
  });

  // --- Contest Lifecycle Overrides ---
  fastify.post('/:contestId/reopen', {
    schema: {
      tags: ['Contests'],
      summary: 'Reopen a closed contest',
      operationId: 'reopenContest',
      body: zodToJsonSchema(ReopenContestRequestSchema),
      response: { 200: zodToJsonSchema(ContestResponseSchema) },
    },
    handler: overrides.reopenContest,
  });
  fastify.post('/:contestId/close', {
    schema: {
      tags: ['Contests'],
      summary: 'Close a contest early',
      operationId: 'closeContest',
      body: zodToJsonSchema(CloseContestRequestSchema),
      response: { 200: zodToJsonSchema(ContestResponseSchema) },
    },
    handler: overrides.closeContest,
  });
  fastify.post('/:contestId/extend-deadline', {
    schema: {
      tags: ['Contests'],
      summary: 'Extend the contest end deadline',
      operationId: 'extendContestDeadline',
      body: zodToJsonSchema(ExtendContestDeadlineRequestSchema),
      response: { 200: zodToJsonSchema(ContestResponseSchema) },
    },
    handler: overrides.extendDeadline,
  });
  fastify.post('/:contestId/update-lock', {
    schema: {
      tags: ['Contests'],
      summary: 'Update the contest lock time',
      operationId: 'updateContestLockTime',
      body: zodToJsonSchema(UpdateContestLockTimeRequestSchema),
      response: { 200: zodToJsonSchema(ContestResponseSchema) },
    },
    handler: overrides.updateLockTime,
  });
  // --- Contest Audit Log ---
  fastify.get('/:contestId/audit-log', {
    schema: {
      tags: ['Contests'],
      summary: 'Get the audit log for a contest',
      operationId: 'getContestAuditLog',
      response: { 200: zodToJsonSchema(ContestAuditLogResponseSchema) },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const { AuditService: AuditSvc } = await import('../leagues/audit-service.js');
      const auditService = new AuditSvc(prisma);
      const entries = await auditService.getContestAuditLog(contestId);
      return reply.send({ entries });
    },
  });
}
