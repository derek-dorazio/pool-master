/**
 * Ingestion route handlers (#205). Each extracts the request, delegates to IngestionService, and
 * maps the result through `mappers/ingestion.mapper.ts`.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  EventSyncRequest,
  ProviderSyncRunListQuery,
  UpdateProviderLeagueRequest,
  UpdateProviderRequest,
} from '@poolmaster/shared/dto';
import { ProviderSettingsError, type ProviderSettingsService } from './provider-settings-service';
import type { IngestionService } from './ingestion-service';
import { SyncRequestValidationError } from './core/sync-orchestrator';
import {
  ProviderSyncRunNotFoundError,
  SportEventNotSyncedError,
  SportProviderNotFoundError,
} from './ingestion-service';
import { sendError } from '../../core/error-handler';
import { requireAuthUser } from '../../plugins/auth-guard';
import {
  toProviderLeagueDto,
  toProviderSettingsDto,
  toProviderManualSyncSubmissionResponse,
  toProviderListResponse,
  toProviderSyncRunDetailDto,
  toProviderSyncRunDto,
} from '../../mappers';

export function createIngestionHandlers(
  ingestionService: IngestionService,
  providerSettings: ProviderSettingsService,
) {
  return {
    listProviders,
    updateProvider,
    updateProviderLeague,
    listSyncRuns,
    getSyncRun,
    submitEventSync,
  };

  async function listProviders(request: FastifyRequest, reply: FastifyReply) {
    const logger = request.contextLogger ?? request.log;
    logger.debug('Listing providers');
    const providers = await ingestionService.listProviders();
    logger.info({ count: providers.length }, 'Listed providers');
    return reply.send(toProviderListResponse(providers));
  }

  async function updateProvider(
    request: FastifyRequest<{ Params: { providerId: string }; Body: UpdateProviderRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const saved = await providerSettings.updateProvider(request.params.providerId, request.body);
      return reply.send({ provider: toProviderSettingsDto(saved.provider, saved.webhookSecretSet) });
    } catch (err) {
      if (err instanceof ProviderSettingsError) return sendError(reply, err.statusCode, err.code, err.message);
      throw err;
    }
  }

  async function updateProviderLeague(
    request: FastifyRequest<{ Params: { providerId: string; providerLeagueId: string }; Body: UpdateProviderLeagueRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const saved = await providerSettings.updateLeague(request.params.providerId, request.params.providerLeagueId, request.body);
      return reply.send({ league: toProviderLeagueDto(saved) });
    } catch (err) {
      if (err instanceof ProviderSettingsError) return sendError(reply, err.statusCode, err.code, err.message);
      throw err;
    }
  }

  async function listSyncRuns(
    request: FastifyRequest<{ Querystring: ProviderSyncRunListQuery }>,
    reply: FastifyReply,
  ) {
    const logger = request.contextLogger ?? request.log;
    const { providerId, sport, status, from, to } = request.query;
    logger.debug({ providerId, sport, status, from, to }, 'Listing provider sync runs');
    const syncRuns = await ingestionService.listSyncRuns({
      providerId,
      sport,
      status,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    logger.info({ count: syncRuns.length }, 'Listed provider sync runs');
    return reply.send({ syncRuns: syncRuns.map(toProviderSyncRunDto) });
  }

  async function getSyncRun(
    request: FastifyRequest<{ Params: { syncRunId: string } }>,
    reply: FastifyReply,
  ) {
    const logger = request.contextLogger ?? request.log;
    const { syncRunId } = request.params;
    logger.debug({ syncRunId }, 'Reading provider sync run');
    try {
      const run = await ingestionService.getSyncRun(syncRunId);
      logger.info({ syncRunId, hasDetails: run.details !== null }, 'Read provider sync run');
      return reply.send(toProviderSyncRunDetailDto(run));
    } catch (err) {
      if (err instanceof ProviderSyncRunNotFoundError) {
        logger.warn({ syncRunId }, 'Provider sync run not found');
        return sendError(reply, 404, 'SYNC_RUN_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  async function submitEventSync(
    request: FastifyRequest<{
      Params: { eventId: string };
      Body: EventSyncRequest;
    }>,
    reply: FastifyReply,
  ) {
    const { userId: rootAdminUserId, email: rootAdminEmail } = requireAuthUser(request);
    const logger = request.contextLogger ?? request.log;
    const { eventId } = request.params;
    logger.debug({ eventId, requestedKinds: request.body.kinds }, 'Running manual event sync');

    try {
      const result = await ingestionService.syncSportEvent(eventId, request.body.kinds, rootAdminUserId, rootAdminEmail);
      return reply.code(202).send(toProviderManualSyncSubmissionResponse(result));
    } catch (err) {
      if (err instanceof SportEventNotSyncedError) {
        logger.warn({ eventId, code: err.code }, 'Manual event sync refused: the event is not one its provider syncs');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      if (err instanceof SportProviderNotFoundError) {
        logger.warn({ eventId }, 'Manual event sync failed because no providers were registered');
        return sendError(reply, 404, 'SPORT_PROVIDER_NOT_FOUND', err.message);
      }
      if (err instanceof SyncRequestValidationError) {
        logger.warn({ eventId, validationCode: err.code }, 'Manual event sync failed validation');
        return sendError(reply, 422, 'SYNC_REQUEST_INVALID', err.message, { validationCode: err.code });
      }
      throw err;
    }
  }
}
