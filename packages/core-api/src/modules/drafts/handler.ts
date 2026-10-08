/**
 * Draft handlers (#324) — actor resolution, and the DTO the route sends.
 *
 * `docs/LAYERS.md` §2.4: a service never sees a `request`. So reading the caller off the
 * request and the entry off the path and body happens here, and `DraftService` takes them as
 * arguments. The projection onto the published shape is `mappers/drafts.mapper.ts`.
 *
 * Status codes: a `DraftError` carries its own `code` and `statusCode`, so letting it
 * propagate to `core/error-handler`'s `globalErrorHandler` produces exactly the envelope the
 * route used to build by hand — the same convention `SportEventError` follows. That is why
 * there is no catch here and no `sendWithStatus` any more.
 */

import type { FastifyRequest } from 'fastify';
import type {
  DraftPickResponse,
  DraftStateQuery,
  DraftStateResponse,
  SubmitPickRequest,
} from '@poolmaster/shared/dto';
import { toDraftStateResponse } from '../../mappers/drafts.mapper';
import type { DraftService } from './service';

type ContestParams = { contestId: string };
type DraftStateRequest = FastifyRequest<{ Params: ContestParams; Querystring: DraftStateQuery }>;
type SubmitSelectionRequest = FastifyRequest<{ Params: ContestParams; Body: SubmitPickRequest }>;
type SubmitEntryRequest = FastifyRequest<{ Params: ContestParams & { entryId: string } }>;

/**
 * Function-typed properties rather than method shorthand: the route passes each of these to
 * Fastify detached from this object, which `@typescript-eslint/unbound-method` flags for a
 * declared method and not for a function property.
 */
export interface DraftHandlers {
  getDraftState: (request: DraftStateRequest) => Promise<DraftStateResponse>;
  submitContestSelection: (request: SubmitSelectionRequest) => Promise<DraftPickResponse>;
  submitContestEntry: (request: SubmitEntryRequest) => Promise<DraftStateResponse>;
}

export function createDraftHandlers(service: DraftService): DraftHandlers {
  async function getDraftState(request: DraftStateRequest): Promise<DraftStateResponse> {
    const view = await service.getDraftState({
      contestId: request.params.contestId,
      selectedEntryId: request.query?.entryId,
      actorUserId: request.authUser?.userId,
      actorIsRootAdmin: request.authUser?.isRootAdmin === true,
    });
    return toDraftStateResponse(view);
  }

  /**
   * Both of a submission's outcomes — a pick placed (displacing one when the tier it goes in
   * is already full) and a pick toggled off — answer 200 with the refreshed room. They are
   * distinct in the service because they are distinct behaviour; they are one response here
   * because the client's next render is the same either way.
   */
  async function submitContestSelection(
    request: SubmitSelectionRequest,
  ): Promise<DraftPickResponse> {
    const { entryId, participantId } = request.body;
    const result = await service.submitSelection({
      contestId: request.params.contestId,
      entryId,
      participantId,
      actorUserId: request.authUser?.userId,
    });
    return toDraftStateResponse(result.view);
  }

  /** Submitting an entry answers with the refreshed room, as a pick does (#481). */
  async function submitContestEntry(request: SubmitEntryRequest): Promise<DraftStateResponse> {
    const view = await service.submitEntry({
      contestId: request.params.contestId,
      entryId: request.params.entryId,
      actorUserId: request.authUser?.userId,
    });
    return toDraftStateResponse(view);
  }

  return { getDraftState, submitContestSelection, submitContestEntry };
}
