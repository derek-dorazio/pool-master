/**
 * Scoring route handlers — delegates to ScoringService.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ScoringService } from './service';

// --- Param Types ---

interface ContestParams {
  contestId: string;
}

interface EntryParams extends ContestParams {
  entryId: string;
}

interface ParticipantParams extends ContestParams {
  participantId: string;
}

// --- Handlers ---

export interface ScoringHandlerDeps {
  scoringService: ScoringService;
}

/** Handler for GET /scoring/contests/:contestId/leaderboard */
export function createGetLeaderboardHandler(deps: ScoringHandlerDeps) {
  return async (
    request: FastifyRequest<{ Params: ContestParams }>,
    _reply: FastifyReply,
  ) => {
    const logger = request.contextLogger ?? request.log;
    const { contestId } = request.params;
    logger.debug({ contestId }, 'Handling scoring leaderboard read');
    const leaderboard = await deps.scoringService.getLeaderboard(contestId);
    logger.info({ contestId, entryCount: leaderboard.length }, 'Handled scoring leaderboard read');
    return { contestId, leaderboard };
  };
}

/** Handler for GET /scoring/contests/:contestId/entry/:entryId */
export function createGetEntryScoreHandler(deps: ScoringHandlerDeps) {
  return async (
    request: FastifyRequest<{ Params: EntryParams }>,
    _reply: FastifyReply,
  ) => {
    const logger = request.contextLogger ?? request.log;
    const { contestId, entryId } = request.params;
    logger.debug({ contestId, entryId }, 'Handling scoring entry breakdown read');
    const detail = await deps.scoringService.getEntryScore(contestId, entryId);
    logger.info({ contestId, entryId, timelineCount: detail.timeline.length }, 'Handled scoring entry breakdown read');
    return detail;
  };
}

/** Handler for GET /scoring/contests/:contestId/participant/:participantId */
export function createGetParticipantScoreHandler(deps: ScoringHandlerDeps) {
  return async (
    request: FastifyRequest<{ Params: ParticipantParams }>,
    _reply: FastifyReply,
  ) => {
    const logger = request.contextLogger ?? request.log;
    const { contestId, participantId } = request.params;
    logger.debug({ contestId, participantId }, 'Handling participant score history read');
    const history = await deps.scoringService.getParticipantScoreHistory(contestId, participantId);
    logger.info({ contestId, participantId, scoreEventCount: history.scores.length }, 'Handled participant score history read');
    return history;
  };
}

/** Handler for POST /scoring/contests/:contestId/rollup */
export function createTriggerRollupHandler(deps: ScoringHandlerDeps) {
  return async (
    request: FastifyRequest<{ Params: ContestParams }>,
    _reply: FastifyReply,
  ) => {
    const logger = request.contextLogger ?? request.log;
    const { contestId } = request.params;
    logger.debug({ contestId }, 'Handling manual scoring rollup');
    const result = await deps.scoringService.triggerRollup(contestId);
    logger.info({ contestId, entriesUpdated: result.entriesUpdated }, 'Handled manual scoring rollup');
    return result;
  };
}

/** Handler for GET /scoring/health */
export function createGetHealthHandler(deps: ScoringHandlerDeps) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const logger = request.contextLogger ?? request.log;
    logger.debug('Handling scoring health read');
    const detail = deps.scoringService.getHealth();
    logger.info({ eventDriven: detail.eventDriven }, 'Handled scoring health read');
    return detail;
  };
}
