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
    const { contestId } = request.params;
    const leaderboard = await deps.scoringService.getLeaderboard(contestId);
    return { contestId, leaderboard };
  };
}

/** Handler for GET /scoring/contests/:contestId/entry/:entryId */
export function createGetEntryScoreHandler(deps: ScoringHandlerDeps) {
  return async (
    request: FastifyRequest<{ Params: EntryParams }>,
    _reply: FastifyReply,
  ) => {
    const { contestId, entryId } = request.params;
    const detail = await deps.scoringService.getEntryScore(contestId, entryId);
    return detail;
  };
}

/** Handler for GET /scoring/contests/:contestId/participant/:participantId */
export function createGetParticipantScoreHandler(deps: ScoringHandlerDeps) {
  return async (
    request: FastifyRequest<{ Params: ParticipantParams }>,
    _reply: FastifyReply,
  ) => {
    const { contestId, participantId } = request.params;
    const history = await deps.scoringService.getParticipantScoreHistory(contestId, participantId);
    return history;
  };
}

/** Handler for POST /scoring/contests/:contestId/rollup */
export function createTriggerRollupHandler(deps: ScoringHandlerDeps) {
  return async (
    request: FastifyRequest<{ Params: ContestParams }>,
    _reply: FastifyReply,
  ) => {
    const { contestId } = request.params;
    const result = await deps.scoringService.triggerRollup(contestId);
    return result;
  };
}

/** Handler for GET /scoring/health */
export function createGetHealthHandler(deps: ScoringHandlerDeps) {
  return async (_request: FastifyRequest, _reply: FastifyReply) => {
    return deps.scoringService.getHealth();
  };
}
