/**
 * Contests module — registers contest CRUD routes under /api/v1/leagues/:id/contests
 * and standalone contest routes under /api/v1/contests.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { CommissionerPermission } from '@poolmaster/shared/domain';
import {
  PrismaContestRepository,
  PrismaSelectionConfigRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaContestEntryRepository,
  PrismaContestStandingRepository,
  PrismaDraftSessionRepository,
} from '../../adapters';
import { requirePermission } from '../../core/require-permission';
import { ContestService } from './service';
import { OverrideService } from './override-service';
import { createContestHandlers } from './handler';
import { createOverrideHandlers } from './override-handler';

export async function contestsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const contestRepo = new PrismaContestRepository(prisma);
  const selectionConfigRepo = new PrismaSelectionConfigRepository(prisma);
  const membershipRepo = new PrismaLeagueMembershipRepository(prisma);
  const leagueRepo = new PrismaLeagueRepository(prisma);

  const contestService = new ContestService(
    contestRepo,
    selectionConfigRepo,
    membershipRepo,
    leagueRepo,
  );
  const handlers = createContestHandlers(contestService);

  // --- League-scoped contest routes (under /api/v1/leagues/:id/contests) ---
  // Note: These are registered under the leagues prefix, so :id = leagueId

  fastify.get('/', {
    schema: {
      tags: ['Contests'],
      summary: 'List contests for a league',
      operationId: 'listContests',
      // TODO: add response schema after handler uses DTO mappers
    },
    handler: handlers.listContests,
  });

  fastify.post('/', {
    schema: {
      tags: ['Contests'],
      summary: 'Create a new contest in a league',
      operationId: 'createContest',
      body: {
        type: 'object',
        required: ['name', 'contestType', 'selectionType', 'scoringEngine'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          contestType: { type: 'string', enum: ['SINGLE_EVENT'] },
          selectionType: {
            type: 'string',
            enum: ['SNAKE_DRAFT', 'TIERED', 'BUDGET_PICK', 'OPEN_SELECTION', 'PICK_EM', 'BRACKET_PICK_EM'],
          },
          scoringEngine: {
            type: 'string',
            enum: ['ADVANCEMENT', 'STAT_ACCUMULATION', 'STROKE_PLAY', 'POSITION', 'BRACKET', 'FIGHT_RESULT', 'CUMULATIVE'],
          },
          seasonId: { type: 'string' },
          selectionConfig: { type: 'object' },
          scoringRules: { type: 'object' },
          scoringTemplateKey: { type: 'string' },
          payoutConfig: {
            type: 'object',
            properties: {
              entryFee: { type: 'integer', minimum: 0 },
              prizePool: { type: 'integer', minimum: 0 },
              payoutStructure: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['rank', 'percentage'],
                  properties: {
                    rank: { type: 'integer', minimum: 1 },
                    percentage: { type: 'number', minimum: 0, maximum: 100 },
                    fixedAmount: { type: 'integer', minimum: 0 },
                  },
                },
              },
              intermediatePrizes: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    amount: { type: 'integer', minimum: 0 },
                    percentage: { type: 'number', minimum: 0, maximum: 100 },
                  },
                },
              },
            },
          },
          startsAt: { type: 'string', format: 'date-time' },
          endsAt: { type: 'string', format: 'date-time' },
          lockAt: { type: 'string', format: 'date-time' },
          isExclusive: { type: 'boolean' },
          scoringStopsOnElimination: { type: 'boolean' },
        },
      },
      // TODO: add response schema after handler uses DTO mappers
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
  const leagueRepo = new PrismaLeagueRepository(prisma);
  const entryRepo = new PrismaContestEntryRepository(prisma);
  const standingRepo = new PrismaContestStandingRepository(prisma);
  const draftSessionRepo = new PrismaDraftSessionRepository(prisma);

  const contestService = new ContestService(
    contestRepo,
    selectionConfigRepo,
    membershipRepo,
    leagueRepo,
  );
  const overrideService = new OverrideService(contestRepo, draftSessionRepo, entryRepo, standingRepo);
  const handlers = createContestHandlers(contestService);
  const overrides = createOverrideHandlers(overrideService);

  // --- Contest CRUD ---
  fastify.get('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Get a contest by ID',
      operationId: 'getContest',
      // TODO: add response schema after handler uses DTO mappers
    },
    handler: handlers.getContest,
  });

  fastify.put('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Update a contest',
      operationId: 'updateContest',
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          scoringRules: { type: 'object' },
          payoutConfig: { type: 'object' },
          startsAt: { type: 'string', format: 'date-time' },
          endsAt: { type: 'string', format: 'date-time' },
          lockAt: { type: 'string', format: 'date-time' },
          isExclusive: { type: 'boolean' },
        },
      },
      // TODO: add response schema after handler uses DTO mappers
    },
    handler: handlers.updateContest,
  });

  fastify.delete('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Delete a contest',
      operationId: 'deleteContest',
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
    },
    handler: overrides.undoPick,
  });
  fastify.post('/:contestId/draft/pause', {
    schema: {
      tags: ['Contests'],
      summary: 'Pause an active draft',
      operationId: 'pauseDraft',
      body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } },
    },
    handler: overrides.pauseDraft,
  });
  fastify.post('/:contestId/draft/resume', {
    schema: {
      tags: ['Contests'],
      summary: 'Resume a paused draft',
      operationId: 'resumeDraft',
    },
    handler: overrides.resumeDraft,
  });
  fastify.post('/:contestId/draft/extend-clock', {
    schema: {
      tags: ['Contests'],
      summary: 'Extend the pick clock for the current drafter',
      operationId: 'extendPickClock',
      body: { type: 'object', required: ['additionalSeconds'], properties: { additionalSeconds: { type: 'integer', minimum: 1 } } },
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
    },
    handler: overrides.adjustScore,
  });
  fastify.post('/:contestId/scoring/recalculate', {
    schema: {
      tags: ['Contests'],
      summary: 'Recalculate standings for a contest',
      operationId: 'recalculateStandings',
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
    },
    handler: overrides.reopenContest,
  });
  fastify.post('/:contestId/close', {
    schema: {
      tags: ['Contests'],
      summary: 'Close a contest early',
      operationId: 'closeContest',
      body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } },
    },
    handler: overrides.closeContest,
  });
  fastify.post('/:contestId/extend-deadline', {
    schema: {
      tags: ['Contests'],
      summary: 'Extend the contest end deadline',
      operationId: 'extendContestDeadline',
      body: { type: 'object', required: ['newEnd', 'reason'], properties: { newEnd: { type: 'string', format: 'date-time' }, reason: { type: 'string' } } },
    },
    handler: overrides.extendDeadline,
  });
  fastify.post('/:contestId/update-lock', {
    schema: {
      tags: ['Contests'],
      summary: 'Update the contest lock time',
      operationId: 'updateContestLockTime',
      body: { type: 'object', required: ['newLock', 'reason'], properties: { newLock: { type: 'string', format: 'date-time' }, reason: { type: 'string' } } },
    },
    handler: overrides.updateLockTime,
  });

  // --- Payout Overrides ---
  fastify.post('/:contestId/payouts/confirm', {
    schema: {
      tags: ['Contests'],
      summary: 'Confirm and finalize contest payouts',
      operationId: 'confirmPayouts',
    },
    handler: overrides.confirmPayouts,
  });

  // --- Contest Audit Log ---
  fastify.get('/:contestId/audit-log', {
    schema: {
      tags: ['Contests'],
      summary: 'Get the audit log for a contest',
      operationId: 'getContestAuditLog',
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
