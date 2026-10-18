/**
 * Selection handlers (#324) — actor resolution, and the DTO the route sends.
 *
 * `docs/LAYERS.md` §2.4: a service never sees a `request`. So reading the caller off the
 * request and the entry off the path and body happens here, and `SelectionService` takes them as
 * arguments. The projection onto the published shape is `mappers/selections.mapper.ts`.
 *
 * Status codes: a `SelectionError` carries its own `code` and `statusCode`, so letting it
 * propagate to `core/error-handler`'s `globalErrorHandler` produces exactly the envelope the
 * route used to build by hand — the same convention `SportEventError` follows. That is why
 * there is no catch here and no `sendWithStatus` any more.
 */

import type { FastifyRequest } from 'fastify';
import type {
  GamePicksResponse,
  SaveGamePicksRequest,
  SelectionPickResponse,
  SelectionStateQuery,
  SelectionStateResponse,
  SubmitPickRequest,
} from '@poolmaster/shared/dto';
import { toGamePickWrites, toGamePicksResponse } from '../../mappers/game-picks.mapper';
import { toSelectionStateResponse } from '../../mappers/selections.mapper';
import type { PredictionService } from './prediction-service';
import type { SelectionService } from './service';

type ContestParams = { contestId: string };
type SelectionStateRequest = FastifyRequest<{ Params: ContestParams; Querystring: SelectionStateQuery }>;
type SubmitSelectionRequest = FastifyRequest<{ Params: ContestParams; Body: SubmitPickRequest }>;
type SubmitEntryRequest = FastifyRequest<{ Params: ContestParams & { entryId: string; sportEventId: string } }>;
type RunDrawRequest = FastifyRequest<{ Params: ContestParams }>;
type EntryEventParams = ContestParams & { entryId: string; sportEventId: string };
type GamePicksRequest = FastifyRequest<{ Params: EntryEventParams }>;
type SaveGamePicksHttpRequest = FastifyRequest<{ Params: EntryEventParams; Body: SaveGamePicksRequest }>;
type ClearGamePickRequest = FastifyRequest<{ Params: EntryEventParams & { sportEventMatchId: string } }>;

/**
 * Function-typed properties rather than method shorthand: the route passes each of these to
 * Fastify detached from this object, which `@typescript-eslint/unbound-method` flags for a
 * declared method and not for a function property.
 */
export interface SelectionHandlers {
  getSelectionState: (request: SelectionStateRequest) => Promise<SelectionStateResponse>;
  submitContestSelection: (request: SubmitSelectionRequest) => Promise<SelectionPickResponse>;
  submitContestEntry: (request: SubmitEntryRequest) => Promise<SelectionStateResponse>;
  runContestDraw: (request: RunDrawRequest) => Promise<SelectionStateResponse>;
  getGamePicks: (request: GamePicksRequest) => Promise<GamePicksResponse>;
  saveGamePicks: (request: SaveGamePicksHttpRequest) => Promise<GamePicksResponse>;
  clearGamePick: (request: ClearGamePickRequest) => Promise<GamePicksResponse>;
  submitGamePicks: (request: GamePicksRequest) => Promise<GamePicksResponse>;
}

export function createSelectionHandlers(service: SelectionService, predictions: PredictionService): SelectionHandlers {
  async function getSelectionState(request: SelectionStateRequest): Promise<SelectionStateResponse> {
    const view = await service.getSelectionState({
      contestId: request.params.contestId,
      selectedEntryId: request.query.entryId,
      sportEventId: request.query.sportEventId,
      actorUserId: request.authUser?.userId,
      actorIsRootAdmin: request.authUser?.isRootAdmin === true,
    });
    return toSelectionStateResponse(view);
  }

  /**
   * Both of a submission's outcomes — a pick placed (displacing one when the tier it goes in
   * is already full) and a pick toggled off — answer 200 with the refreshed room. They are
   * distinct in the service because they are distinct behaviour; they are one response here
   * because the client's next render is the same either way.
   */
  async function submitContestSelection(
    request: SubmitSelectionRequest,
  ): Promise<SelectionPickResponse> {
    const { entryId, participantId } = request.body;
    const result = await service.submitSelection({
      contestId: request.params.contestId,
      entryId,
      participantId,
      actorUserId: request.authUser?.userId,
    });
    return toSelectionStateResponse(result.view);
  }

  /** Submitting an entry's picks for one event answers with the refreshed room, as a pick does (#481, #713). */
  async function submitContestEntry(request: SubmitEntryRequest): Promise<SelectionStateResponse> {
    const view = await service.submitEntry({
      contestId: request.params.contestId,
      entryId: request.params.entryId,
      sportEventId: request.params.sportEventId,
      actorUserId: request.authUser?.userId,
    });
    return toSelectionStateResponse(view);
  }

  /** Running a random draw answers with the room as dealt (#601). */
  async function runContestDraw(request: RunDrawRequest): Promise<SelectionStateResponse> {
    const view = await service.runDraw({
      contestId: request.params.contestId,
      actorUserId: request.authUser?.userId,
    });
    return toSelectionStateResponse(view);
  }

  /** The entry and event a game-pick request names, and who is asking (#716). */
  function gamePicksInput(request: GamePicksRequest) {
    return {
      contestId: request.params.contestId,
      entryId: request.params.entryId,
      sportEventId: request.params.sportEventId,
      actorUserId: request.authUser?.userId,
    };
  }

  async function getGamePicks(request: GamePicksRequest): Promise<GamePicksResponse> {
    return toGamePicksResponse(await predictions.getGamePicks(gamePicksInput(request)));
  }

  async function saveGamePicks(request: SaveGamePicksHttpRequest): Promise<GamePicksResponse> {
    const view = await predictions.saveGamePicks({
      ...gamePicksInput(request),
      picks: toGamePickWrites(request.body),
      tiebreakerValue: request.body.tiebreakerValue,
    });
    return toGamePicksResponse(view);
  }

  async function clearGamePick(request: ClearGamePickRequest): Promise<GamePicksResponse> {
    const view = await predictions.clearGamePick({
      ...gamePicksInput(request),
      sportEventMatchId: request.params.sportEventMatchId,
    });
    return toGamePicksResponse(view);
  }

  async function submitGamePicks(request: GamePicksRequest): Promise<GamePicksResponse> {
    return toGamePicksResponse(await predictions.submitGamePicks(gamePicksInput(request)));
  }

  return {
    getSelectionState,
    submitContestSelection,
    submitContestEntry,
    runContestDraw,
    getGamePicks,
    saveGamePicks,
    clearGamePick,
    submitGamePicks,
  };
}
