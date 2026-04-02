/**
 * Draft module — REST routes for async snake draft and selection templates.
 *
 * In async mode, picks are submitted via HTTP POST.
 * The timer runs server-side; auto-pick triggers if the deadline passes.
 */

import type { FastifyInstance } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import crypto from 'node:crypto';
import {
  SELECTION_TEMPLATES,
  getTemplatesForSport,
  getTemplatesForContestType,
  getTemplateById,
} from './templates/selection-templates';
import { SnakeDraftEngine } from './engine/snake-draft-engine';
import type { DraftState } from './engine/snake-draft-engine';
import {
  startSession,
  isPickExpired,
} from './engine/draft-session-manager';
import type { SessionState } from './engine/draft-session-manager';
import { draftStore } from './storage/draft-store';
import { draftQueue } from './engine/draft-queue';

const engine = new SnakeDraftEngine();

/** Build a response payload from session + draft state. */
function buildDraftResponse(session: SessionState, state: DraftState, availableParticipants: string[]) {
  const takenIds = engine.getTakenParticipantIds(state);
  const remaining = availableParticipants.filter((id) => !takenIds.includes(id));

  return {
    contestId: state.contestId,
    status: session.status,
    currentPickNumber: state.currentPickNumber,
    currentEntryId: state.status === 'LIVE' && !engine.isComplete(state)
      ? engine.getCurrentEntryId(state)
      : null,
    pickDeadline: session.pickDeadline,
    rounds: state.rounds,
    entryIds: state.entryIds,
    picks: state.picks,
    availableParticipants: remaining,
    isComplete: engine.isComplete(state),
  };
}

export async function draftsModule(fastify: FastifyInstance): Promise<void> {
  /** Get the current draft state for a contest. */
  fastify.get('/:contestId', {
    schema: {
      tags: ['Drafts'],
      summary: 'Get current draft state for a contest',
      operationId: 'getDraftState',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };

      const session = await draftStore.getSession(contestId);
      if (!session) {
        return reply.status(404).send({ error: 'DRAFT_NOT_FOUND', message: `No draft session for contest ${contestId}` });
      }

      const state = await draftStore.getState(contestId);
      if (!state) {
        return reply.status(404).send({ error: 'DRAFT_STATE_MISSING', message: `No draft state for contest ${contestId}` });
      }

      const available = await draftStore.getAvailableParticipants(contestId);
      return buildDraftResponse(session, state, available);
    },
  });

  /** Start a draft session. Commissioner only. */
  fastify.post('/:contestId/start', {
    schema: {
      tags: ['Drafts'],
      summary: 'Start a new draft session',
      operationId: 'startDraft',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          entryIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 2 },
          rounds: { type: 'number', minimum: 1, maximum: 30 },
          timePerPickSeconds: { type: 'number', minimum: 10, maximum: 86400 },
          availableParticipantIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
          autoPickPolicy: { type: 'string', enum: ['QUEUE_THEN_BEST', 'BEST_AVAILABLE', 'RANDOM'] },
        },
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const body = (request.body ?? {}) as {
        entryIds?: string[];
        rounds?: number;
        timePerPickSeconds?: number;
        availableParticipantIds?: string[];
        autoPickPolicy?: string;
      };

      // Check if draft already exists
      if (draftStore.has(contestId)) {
        return reply.status(409).send({ error: 'DRAFT_EXISTS', message: `Draft already exists for contest ${contestId}` });
      }

      const entryIds = body.entryIds ?? [crypto.randomUUID(), crypto.randomUUID()];
      const rounds = body.rounds ?? 5;
      const timePerPickSeconds = body.timePerPickSeconds ?? 120;
      const availableParticipantIds = body.availableParticipantIds ?? [];
      const autoPickPolicy = (body.autoPickPolicy as 'QUEUE_THEN_BEST' | 'BEST_AVAILABLE' | 'RANDOM') ?? 'BEST_AVAILABLE';

      // Create session in PENDING state, then start it
      const pendingSession: SessionState = {
        sessionId: crypto.randomUUID(),
        contestId,
        status: 'PENDING',
        currentPickNumber: 0,
        currentEntryId: null,
        startedAt: null,
        pickDeadline: null,
        timePerPickSeconds,
      };

      const liveSession = startSession(pendingSession);

      const initialState: DraftState = {
        contestId,
        status: 'LIVE',
        entryIds,
        rounds,
        currentPickNumber: 1,
        picks: [],
        autoPickPolicy,
      };

      // Update session with current entry
      liveSession.currentEntryId = engine.getCurrentEntryId(initialState);

      await draftStore.setSession(contestId, liveSession);
      await draftStore.setState(contestId, initialState);
      await draftStore.setAvailableParticipants(contestId, availableParticipantIds);

      return reply.status(201).send(buildDraftResponse(liveSession, initialState, availableParticipantIds));
    },
  });

  /** Submit a pick (async mode). */
  fastify.post('/:contestId/pick', {
    schema: {
      tags: ['Drafts'],
      summary: 'Submit a draft pick',
      operationId: 'submitDraftPick',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['entryId', 'participantId'],
        properties: {
          entryId: { type: 'string', format: 'uuid' },
          participantId: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const { entryId, participantId } = request.body as {
        entryId: string;
        participantId: string;
      };

      const session = await draftStore.getSession(contestId);
      if (!session) {
        return reply.status(404).send({ error: 'DRAFT_NOT_FOUND', message: `No draft session for contest ${contestId}` });
      }

      let state = await draftStore.getState(contestId);
      if (!state) {
        return reply.status(404).send({ error: 'DRAFT_STATE_MISSING', message: `No draft state for contest ${contestId}` });
      }

      const available = await draftStore.getAvailableParticipants(contestId);

      // Check for auto-pick if timer expired
      if (isPickExpired(session)) {
        const currentEntryId = engine.getCurrentEntryId(state);
        const queueEntries = draftQueue.getQueue(currentEntryId);
        const autoPickId = engine.resolveAutoPick(state, {
          entryId: currentEntryId,
          queue: queueEntries,
          availableParticipantIds: available,
        });

        if (autoPickId) {
          state = engine.applyPick(state, { entryId: currentEntryId, participantId: autoPickId }, true);
          session.pickDeadline = new Date(Date.now() + session.timePerPickSeconds * 1000);

          if (!engine.isComplete(state)) {
            session.currentEntryId = engine.getCurrentEntryId(state);
          } else {
            session.status = 'COMPLETE';
            session.pickDeadline = null;
            session.currentEntryId = null;
          }

          await draftStore.setSession(contestId, session);
          await draftStore.setState(contestId, state);
        }
      }

      // Validate the proposed pick
      const validation = engine.validatePick(state, { entryId, participantId });
      if (!validation.valid) {
        return reply.status(400).send({ error: 'INVALID_PICK', message: validation.reason });
      }

      // Apply the pick
      state = engine.applyPick(state, { entryId, participantId });

      // Update session for next pick
      if (!engine.isComplete(state)) {
        session.currentEntryId = engine.getCurrentEntryId(state);
        session.currentPickNumber = state.currentPickNumber;
        session.pickDeadline = new Date(Date.now() + session.timePerPickSeconds * 1000);
      } else {
        session.status = 'COMPLETE';
        state = { ...state, status: 'COMPLETE' };
        session.currentEntryId = null;
        session.pickDeadline = null;
      }

      await draftStore.setSession(contestId, session);
      await draftStore.setState(contestId, state);

      return buildDraftResponse(session, state, available);
    },
  });

  /** Pause the draft. Commissioner only. */
  fastify.post('/:contestId/pause', {
    schema: {
      tags: ['Drafts'],
      summary: 'Pause an active draft',
      operationId: 'pauseDraft',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      return reply.status(501).send({ contestId, message: 'not implemented' });
    },
  });

  /** Resume the draft. Commissioner only. */
  fastify.post('/:contestId/resume', {
    schema: {
      tags: ['Drafts'],
      summary: 'Resume a paused draft',
      operationId: 'resumeDraft',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      return reply.status(501).send({ contestId, message: 'not implemented' });
    },
  });

  /** Extend the current pick deadline. Commissioner only. */
  fastify.post('/:contestId/extend', {
    schema: {
      tags: ['Drafts'],
      summary: 'Extend the current pick deadline',
      operationId: 'extendPickDeadline',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['additionalSeconds'],
        properties: {
          additionalSeconds: { type: 'number', minimum: 1, maximum: 3600 },
        },
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      return reply.status(501).send({ contestId, message: 'not implemented' });
    },
  });

  // --- Selection Template Routes ---

  /** List all selection templates, optionally filtered by sport and/or contestType. */
  fastify.get('/templates', {
    schema: {
      tags: ['Drafts'],
      summary: 'List selection templates',
      operationId: 'listSelectionTemplates',
      querystring: {
        type: 'object',
        properties: {
          sport: { type: 'string' },
          contestType: { type: 'string' },
        },
      },
    },
    handler: async (request) => {
      const { sport, contestType } = request.query as {
        sport?: string;
        contestType?: string;
      };

      if (sport && contestType) {
        return getTemplatesForContestType(sport as Sport, contestType);
      }
      if (sport) {
        return getTemplatesForSport(sport as Sport);
      }
      return SELECTION_TEMPLATES;
    },
  });

  /** Get a single selection template by ID. */
  fastify.get('/templates/:templateId', {
    schema: {
      tags: ['Drafts'],
      summary: 'Get a selection template by ID',
      operationId: 'getSelectionTemplate',
      params: {
        type: 'object',
        required: ['templateId'],
        properties: { templateId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { templateId } = request.params as { templateId: string };
      const template = getTemplateById(templateId);
      if (!template) {
        return reply.status(404).send({ error: `Template ${templateId} not found` });
      }
      return template;
    },
  });
}
