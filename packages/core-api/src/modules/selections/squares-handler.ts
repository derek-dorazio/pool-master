/**
 * Squares handlers (#711) — the caller and the box off the request, and the DTO the route sends.
 * A `SelectionError` carries its own code and status, so errors propagate to the global handler,
 * as in `handler.ts`.
 */

import type { FastifyRequest } from 'fastify';
import type { ClaimSquaresBoxRequest, SquaresBoardResponse } from '@poolmaster/shared/dto';
import { toSquaresBoardResponse } from '../../mappers/squares.mapper';
import { requireAuthUser } from '../../plugins/auth-guard';
import type { SquaresActor, SquaresService } from './squares-service';

type ContestParams = { contestId: string };
type BoxParams = ContestParams & { rowIndex: number; columnIndex: number };
type BoardRequest = FastifyRequest<{ Params: ContestParams }>;
type ClaimRequest = FastifyRequest<{ Params: BoxParams; Body: ClaimSquaresBoxRequest }>;
type ClearRequest = FastifyRequest<{ Params: BoxParams }>;

/** Function-typed properties, as in `SelectionHandlers`: the route passes each detached. */
export interface SquaresHandlers {
  getSquaresBoard: (request: BoardRequest) => Promise<SquaresBoardResponse>;
  claimSquaresBox: (request: ClaimRequest) => Promise<SquaresBoardResponse>;
  clearSquaresBox: (request: ClearRequest) => Promise<SquaresBoardResponse>;
  drawSquaresNumbers: (request: BoardRequest) => Promise<SquaresBoardResponse>;
}

/** The signed-in caller: every squares route needs a session. */
function actorOf(request: FastifyRequest): SquaresActor {
  const user = requireAuthUser(request);
  return { userId: user.userId, isRootAdmin: user.isRootAdmin };
}

export function createSquaresHandlers(service: SquaresService): SquaresHandlers {
  return {
    getSquaresBoard: async (request) =>
      toSquaresBoardResponse(await service.getBoard(request.params.contestId, actorOf(request))),
    claimSquaresBox: async (request) => {
      const { contestId, rowIndex, columnIndex } = request.params;
      return toSquaresBoardResponse(await service.claim(contestId, rowIndex, columnIndex, request.body.contestEntryId, actorOf(request)));
    },
    clearSquaresBox: async (request) => {
      const { contestId, rowIndex, columnIndex } = request.params;
      return toSquaresBoardResponse(await service.clear(contestId, rowIndex, columnIndex, actorOf(request)));
    },
    drawSquaresNumbers: async (request) =>
      toSquaresBoardResponse(await service.draw(request.params.contestId, actorOf(request))),
  };
}
