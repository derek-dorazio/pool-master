/**
 * Contests module — registers contest CRUD routes under /api/v1/leagues/:id/contests
 * and standalone contest routes under /api/v1/contests.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { CommissionerPermission } from '@poolmaster/shared/domain';
import {
  zodToJsonSchema,
  CreateContestRequestSchema,
  ContestEntryListResponseSchema,
  ContestEntryResponseSchema,
  ContestListResponseSchema,
  MyContestEntryResponseSchema,
  ContestResponseSchema,
  ContestStandingsRecalculationResponseSchema,
  SuccessSchema,
  UpdateContestRequestSchema,
} from '@poolmaster/shared/dto';
import {
  PrismaContestRepository,
  PrismaSelectionConfigRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaContestEntryRepository,
  PrismaDraftSessionRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
  PrismaContestPoolRepository,
  PrismaContestParticipantPoolRepository,
  PrismaContestMatchupRepository,
  PrismaParticipantRepository,
  PrismaParticipantSeasonRecordRepository,
} from '../../adapters';
import { requirePermission } from '../../core/require-permission';
import { ContestService } from './service';
import { OverrideService } from './override-service';
import { createContestHandlers } from './handler';
import { createOverrideHandlers } from './override-handler';
import { ContestPoolService } from '../participants/pool-service';
import { PricingAndTierService } from '../participants/pricing-service';
import { IngestionPersistence } from '../ingestion/persistence/ingestion-persistence';

export async function contestsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const contestRepo = new PrismaContestRepository(prisma);
  const selectionConfigRepo = new PrismaSelectionConfigRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const leagueRepo = new PrismaLeagueRepository(prisma);

  const contestService = new ContestService(
    contestRepo,
    selectionConfigRepo,
    membershipRepo,
    leagueRepo,
    squadRepo,
    squadMembershipRepo,
    undefined,
    prisma,
  );
  const poolRepo = new PrismaContestPoolRepository(prisma);
  const poolParticipantRepo = new PrismaContestParticipantPoolRepository(prisma);
  const contestMatchupRepo = new PrismaContestMatchupRepository(prisma);
  const participantRepo = new PrismaParticipantRepository(prisma);
  const seasonRecordRepo = new PrismaParticipantSeasonRecordRepository(prisma);
  const poolService = new ContestPoolService(
    poolRepo,
    poolParticipantRepo,
    participantRepo,
    contestMatchupRepo,
    prisma,
    new IngestionPersistence(prisma),
  );
  const pricingService = new PricingAndTierService(
    poolRepo,
    poolParticipantRepo,
    seasonRecordRepo,
    participantRepo,
  );
  const handlers = createContestHandlers(contestService, { poolService, pricingService });

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
      response: { 201: zodToJsonSchema(ContestResponseSchema) },
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
  const selectionConfigRepo = new PrismaSelectionConfigRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const squadRepo = new PrismaSquadRepository(prisma);
  const squadMembershipRepo = new PrismaSquadMembershipRepository(prisma);
  const leagueRepo = new PrismaLeagueRepository(prisma);
  const entryRepo = new PrismaContestEntryRepository(prisma);
  const draftSessionRepo = new PrismaDraftSessionRepository(prisma);

  const contestService = new ContestService(
    contestRepo,
    selectionConfigRepo,
    membershipRepo,
    leagueRepo,
    squadRepo,
    squadMembershipRepo,
    entryRepo,
    prisma,
  );
  const overrideService = new OverrideService(contestRepo, draftSessionRepo, entryRepo);
  const handlers = createContestHandlers(contestService);
  const overrides = createOverrideHandlers(overrideService);

  // --- Contest CRUD ---
  fastify.get('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Get a contest by ID',
      operationId: 'getContest',
      response: { 200: zodToJsonSchema(ContestResponseSchema) },
    },
    handler: handlers.getContest,
  });

  fastify.get('/:contestId/entries', {
    schema: {
      tags: ['Contests'],
      summary: 'List contest entries',
      operationId: 'listContestEntries',
      response: { 200: zodToJsonSchema(ContestEntryListResponseSchema) },
    },
    handler: handlers.listEntries,
  });

  fastify.get('/:contestId/entries/me', {
    schema: {
      tags: ['Contests'],
      summary: 'Get the current user contest entry',
      operationId: 'getMyContestEntry',
      response: { 200: zodToJsonSchema(MyContestEntryResponseSchema) },
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
        200: {
          type: 'object',
          required: ['contestId', 'deleted'],
          properties: {
            contestId: { type: 'string' },
            deleted: { type: 'boolean', enum: [true] },
          },
        },
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
      response: { 200: zodToJsonSchema(ContestResponseSchema) },
    },
    handler: handlers.updateContest,
  });

  fastify.delete('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Delete a contest',
      operationId: 'deleteContest',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: handlers.deleteContest,
  });

  // --- Draft Overrides ---
  fastify.post('/:contestId/draft/undo-pick', {
    schema: {
      tags: ['Contests'],
      summary: 'Undo a draft pick',
      operationId: 'undoDraftPick',
      body: { type: 'object', required: ['pickId', 'reason'], properties: { pickId: { type: 'string' }, reason: { type: 'string' } } },
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: overrides.undoPick,
  });
  fastify.post('/:contestId/draft/pause', {
    schema: {
      tags: ['Contests'],
      summary: 'Pause an active draft (contest override)',
      operationId: 'pauseContestDraft',
      body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } },
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
      body: { type: 'object', required: ['additionalSeconds'], properties: { additionalSeconds: { type: 'integer', minimum: 1 } } },
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
      body: { type: 'object', required: ['entryId', 'adjustment', 'reason'], properties: { entryId: { type: 'string' }, adjustment: { type: 'number' }, reason: { type: 'string' } } },
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: overrides.adjustScore,
  });
  fastify.post('/:contestId/scoring/recalculate', {
    schema: {
      tags: ['Contests'],
      summary: 'Recalculate standings for a contest',
      operationId: 'recalculateStandings',
      response: { 200: zodToJsonSchema(ContestStandingsRecalculationResponseSchema) },
    },
    handler: overrides.recalculateStandings,
  });

  // --- Contest Lifecycle Overrides ---
  fastify.post('/:contestId/reopen', {
    schema: {
      tags: ['Contests'],
      summary: 'Reopen a closed contest',
      operationId: 'reopenContest',
      body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } },
      response: { 200: zodToJsonSchema(ContestResponseSchema) },
    },
    handler: overrides.reopenContest,
  });
  fastify.post('/:contestId/close', {
    schema: {
      tags: ['Contests'],
      summary: 'Close a contest early',
      operationId: 'closeContest',
      body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } },
      response: { 200: zodToJsonSchema(ContestResponseSchema) },
    },
    handler: overrides.closeContest,
  });
  fastify.post('/:contestId/extend-deadline', {
    schema: {
      tags: ['Contests'],
      summary: 'Extend the contest end deadline',
      operationId: 'extendContestDeadline',
      body: { type: 'object', required: ['newEnd', 'reason'], properties: { newEnd: { type: 'string', format: 'date-time' }, reason: { type: 'string' } } },
      response: { 200: zodToJsonSchema(ContestResponseSchema) },
    },
    handler: overrides.extendDeadline,
  });
  fastify.post('/:contestId/update-lock', {
    schema: {
      tags: ['Contests'],
      summary: 'Update the contest lock time',
      operationId: 'updateContestLockTime',
      body: { type: 'object', required: ['newLock', 'reason'], properties: { newLock: { type: 'string', format: 'date-time' }, reason: { type: 'string' } } },
      response: { 200: zodToJsonSchema(ContestResponseSchema) },
    },
    handler: overrides.updateLockTime,
  });

  // --- Payout Overrides ---
  fastify.post('/:contestId/payouts/confirm', {
    schema: {
      tags: ['Contests'],
      summary: 'Confirm and finalize contest payouts',
      operationId: 'confirmPayouts',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: overrides.confirmPayouts,
  });

  // --- Contest Audit Log ---
  fastify.get('/:contestId/audit-log', {
    schema: {
      tags: ['Contests'],
      summary: 'Get the audit log for a contest',
      operationId: 'getContestAuditLog',
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
