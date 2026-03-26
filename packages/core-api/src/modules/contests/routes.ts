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
} from '../../adapters';
import { requirePermission } from '../../core/require-permission';
import { ContestService } from './service';
import { createContestHandlers } from './handler';

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

  fastify.get('/', handlers.listContests);

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'contestType', 'selectionType', 'scoringEngine'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          contestType: { type: 'string', enum: ['SINGLE_EVENT', 'SEASON_LONG'] },
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

  const contestService = new ContestService(
    contestRepo,
    selectionConfigRepo,
    membershipRepo,
    leagueRepo,
  );
  const handlers = createContestHandlers(contestService);

  fastify.get('/:contestId', handlers.getContest);

  fastify.put('/:contestId', {
    schema: {
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
    },
    handler: handlers.updateContest,
  });

  fastify.delete('/:contestId', handlers.deleteContest);
}
