/**
 * Pick preview handlers (#1612): the unsaved setup and trial picks off the request body, and the
 * DTO the route sends. The projections are in the selection and game-pick mappers.
 */

import type { FastifyRequest } from 'fastify';
import type {
  GamePickPreviewRequest,
  GamePickPreviewResponse,
  RosterPickPreviewRequest,
  RosterPickPreviewResponse,
} from '@poolmaster/shared/dto';
import { toGamePickPreviewResponse, toGamePickWrites } from '../../mappers/game-picks.mapper';
import { toRosterPickPreviewResponse } from '../../mappers/selections.mapper';
import type { PredictionService } from './prediction-service';
import type { SelectionService } from './service';

type LeagueParams = { id: string };

/** Function-typed properties, as in `SelectionHandlers`: the route hands each to Fastify detached. */
export interface PickPreviewHandlers {
  previewRosterPicks: (request: FastifyRequest<{ Params: LeagueParams; Body: RosterPickPreviewRequest }>) => Promise<RosterPickPreviewResponse>;
  previewGamePicks: (request: FastifyRequest<{ Params: LeagueParams; Body: GamePickPreviewRequest }>) => Promise<GamePickPreviewResponse>;
}

export function createPickPreviewHandlers(selections: SelectionService, predictions: PredictionService): PickPreviewHandlers {
  return {
    previewRosterPicks: async (request) => toRosterPickPreviewResponse(await selections.previewLineup({
      sportEventId: request.body.sportEventId,
      rules: request.body.rules,
      sportEventParticipantIds: request.body.sportEventParticipantIds,
    })),
    previewGamePicks: async (request) => toGamePickPreviewResponse(await predictions.previewGames({
      sportEventId: request.body.sportEventId,
      rules: request.body.rules,
      picks: toGamePickWrites(request.body),
    })),
  };
}
