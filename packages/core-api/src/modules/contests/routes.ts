/**
 * Contests module — registers contest CRUD routes under /api/v1/leagues/:id/contests
 * and standalone contest routes under /api/v1/contests.
 */

import type { FastifyInstance } from 'fastify';
import {
  AdjustContestScoreRequestSchema,
  CloseContestRequestSchema,
  ContestAuditLogResponseSchema,
  ContestEntryDeletionResponseSchema,
  ContestEntryDetailResponseSchema,
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
  UpdateContestEntryRequestSchema,
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
import { requireCommissioner } from '../leagues/permissions';
import { ContestService } from './service';
import { OverrideService } from './override-service';
import { ContestScoringRecalculationService } from '../contest-scoring';
import { createContestHandlers } from './handler';
import { createOverrideHandlers } from './override-handler';
import { getAppPrisma } from '../../core/prisma-context';

export async function contestsModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
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
    fastify.log,
  );
  const handlers = createContestHandlers(contestService);

  // --- League-scoped contest routes (under /api/v1/leagues/:id/contests) ---
  // Note: These are registered under the leagues prefix, so :id = leagueId

  fastify.get('/', {
    schema: {
      tags: ['Contests'],
      summary: 'List contests for a league',
      description:
        'Returns the contests associated with the parent league so league-home and commissioner views can list current and historical contests.',
      operationId: 'listContests',
      response: { 200: zodToJsonSchema(ContestListResponseSchema) },
    },
    handler: handlers.listContests,
  });

  fastify.post('/', {
    schema: {
      tags: ['Contests'],
      summary: 'Create a new contest in a league',
      description:
        'Creates a contest inside the target league using the league-scoped contest creation flow for commissioners.',
      operationId: 'createContest',
      body: zodToJsonSchema(CreateContestRequestSchema),
      response: {
        201: zodToJsonSchema(ContestResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    preHandler: requireCommissioner(membershipRepo),
    handler: handlers.createContest,
  });
}

/**
 * Standalone contest routes — registered at /api/v1/contests for
 * operations that use contestId rather than leagueId.
 */
export async function contestsByIdModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
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
    fastify.log,
  );
  const overrideService = new OverrideService(
    contestRepo,
    draftSessionRepo,
    entryRepo,
    new ContestScoringRecalculationService(prisma, fastify.log),
  );
  const handlers = createContestHandlers(contestService);
  const overrides = createOverrideHandlers(overrideService);

  // --- Contest CRUD ---
  fastify.get('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Get a contest by ID',
      description:
        'Returns detailed contest information by contest ID for league, entry, and history surfaces that already know the contest identifier.',
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
      description:
        'Lists the contest entries currently registered for the contest, including data needed for administration and participant views.',
      operationId: 'listContestEntries',
      response: {
        200: zodToJsonSchema(ContestEntryListResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.listEntries,
  });

  fastify.get('/:contestId/entries/:entryId', {
    schema: {
      tags: ['Contests'],
      summary: 'Get contest entry detail',
      description:
        'Returns a contest entry plus its current picked participants and latest performance context for entry-detail and expanded leaderboard surfaces.',
      operationId: 'getContestEntry',
      response: {
        200: zodToJsonSchema(ContestEntryDetailResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.getEntry,
  });

  fastify.get('/:contestId/entries/me', {
    schema: {
      tags: ['Contests'],
      summary: 'Get the current user contest entry',
      description:
        'Returns the contest entry owned by the authenticated user when one exists for the target contest.',
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
      summary: 'Create the current user contest entry',
      description:
        'Creates a new contest entry for the authenticated user. This route never returns an existing entry; clients should use the GET entry endpoints to inspect current entry state before or after creation.',
      operationId: 'enterContest',
      response: {
        201: zodToJsonSchema(ContestEntryResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        409: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.createMyEntry,
  });

  fastify.delete('/:contestId/entries/me', {
    schema: {
      tags: ['Contests'],
      summary: 'Delete the current user contest entry',
      description:
        'Deletes the authenticated user contest entry when the contest rules still allow the user to leave the contest.',
      operationId: 'leaveContest',
      response: {
        200: zodToJsonSchema(ContestEntryDeletionResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.deleteMyEntry,
  });

  fastify.patch('/:contestId/entries/:entryId', {
    schema: {
      tags: ['Contests'],
      summary: 'Update a contest entry',
      description:
        'Updates mutable contest-entry fields such as name and tiebreaker prediction while the contest is still joinable.',
      operationId: 'updateContestEntry',
      body: zodToJsonSchema(UpdateContestEntryRequestSchema),
      response: {
        200: zodToJsonSchema(ContestEntryResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.updateEntry,
  });

  fastify.put('/:contestId', {
    schema: {
      tags: ['Contests'],
      summary: 'Update a contest',
      description:
        'Updates mutable contest fields for the target contest and returns the refreshed contest payload.',
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
      description:
        'Deletes the target contest when the contest state and permissions allow removal.',
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
      description:
        'Undoes the most recent draft selection through the contest-level override surface used by commissioners and administrators.',
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
      description:
        'Pauses an active draft through the contest override surface without requiring the dedicated draft-room route family.',
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
      description:
        'Resumes a paused draft through the contest override surface for commissioner or admin intervention.',
      operationId: 'resumeContestDraft',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: overrides.resumeDraft,
  });
  fastify.post('/:contestId/draft/extend-clock', {
    schema: {
      tags: ['Contests'],
      summary: 'Extend the pick clock for the current drafter',
      description:
        'Adds extra time to the current drafter turn through the contest override surface.',
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
      description:
        'Applies a manual score adjustment to a contest entry when commissioner or admin scoring intervention is required.',
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
      description:
        'Triggers a standings recalculation for the contest after score or configuration corrections.',
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
      description:
        'Reopens a previously closed contest so commissioner workflows can resume or correct the contest lifecycle.',
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
      description:
        'Closes the contest ahead of its normal lifecycle when commissioner or admin action requires an early stop.',
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
      description:
        'Moves the contest deadline later to keep the contest open longer without recreating it.',
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
      description:
        'Changes the contest lock time that governs when picks or entries stop being editable.',
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
      description:
        'Returns the audit trail for contest-level actions so commissioner and admin surfaces can review what changed.',
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
