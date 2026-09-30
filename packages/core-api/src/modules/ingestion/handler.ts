/**
 * Ingestion route handlers (#205). Each extracts the request, delegates to IngestionService
 * (or EventScoreSourceService for the catalog browse), and maps the result through
 * `mappers/ingestion.mapper.ts`.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import type {
  ProviderCatalogEventListQuery,
  ProviderEventCleanupRequest,
  ProviderSyncRunListQuery,
} from '@poolmaster/shared/dto';
import type { IngestionService } from './ingestion-service';
import type { EventSyncRequest, SportSyncRequest } from './core/ingestion-scheduler';
import { SyncRequestValidationError } from './core/sync-orchestrator';
import {
  MockEventStateUnsupportedError,
  SportEventSyncScopeError,
  SportSyncNotConfiguredError,
  SportProviderNotFoundError,
} from './ingestion-service';
import type { EventScoreSourceService } from '../events/event-score-source-service';
import { EventScoreSourceError } from '../events/event-score-source-service';
import { sendError } from '../../core/error-handler';
import {
  mapProviderEventCleanupResultToDto,
  toProviderEventDto,
  toProviderManualSyncSubmissionResponse,
  toProviderSummaryDto,
  toProviderSyncRunDto,
  toUnmappedProviderParticipantDto,
} from '../../mappers';

export function createIngestionHandlers(
  ingestionService: IngestionService,
  eventScoreSourceService: EventScoreSourceService,
) {
  return {
    listProviders,
    listSyncRuns,
    submitSportSync,
    submitEventSync,
    listUnmappedParticipants,
    cleanupStaleProviderEvents,
    listProviderCatalogEvents,
  };

  async function listProviders(request: FastifyRequest, reply: FastifyReply) {
    const logger = request.contextLogger ?? request.log;
    logger.debug('Listing providers');
    const providers = await ingestionService.listProviders();
    logger.info({ count: providers.length }, 'Listed providers');
    return reply.send({ providers: providers.map(toProviderSummaryDto) });
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

  async function submitSportSync(
    request: FastifyRequest<{
      Params: { sport: Sport };
      Body: SportSyncRequest;
    }>,
    reply: FastifyReply,
  ) {
    const { userId: rootAdminUserId, email: rootAdminEmail } = request.authUser!;
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      sport: request.params.sport,
      requestedFeeds: request.body.feeds,
    }, 'Preparing sport sync');

    try {
      const result = await ingestionService.prepareSportSync(
        {
          sport: request.params.sport,
          feeds: request.body.feeds,
          from: request.body.from,
          to: request.body.to,
        },
        rootAdminUserId,
        rootAdminEmail,
      );
      return reply.code(202).send(toProviderManualSyncSubmissionResponse(result));
    } catch (err) {
      if (err instanceof SportProviderNotFoundError) {
        logger.warn({ sport: request.params.sport }, 'Sport sync preparation failed because no providers were registered');
        return sendError(reply, 404, 'SPORT_PROVIDER_NOT_FOUND', err.message);
      }
      if (err instanceof SportSyncNotConfiguredError) {
        logger.warn({ sport: request.params.sport }, 'Sport sync preparation failed because sport is not enabled in ingestion config');
        return sendError(reply, 422, 'SPORT_SYNC_NOT_CONFIGURED', err.message);
      }
      if (err instanceof SyncRequestValidationError) {
        logger.warn({
          sport: request.params.sport,
          validationCode: err.code,
        }, 'Sport sync preparation failed validation');
        return sendError(reply, 422, 'SYNC_REQUEST_INVALID', err.message, { validationCode: err.code });
      }
      throw err;
    }
  }

  async function submitEventSync(
    request: FastifyRequest<{
      Params: { sport: Sport; eventId: string };
      Body: EventSyncRequest;
    }>,
    reply: FastifyReply,
  ) {
    const { userId: rootAdminUserId, email: rootAdminEmail } = request.authUser!;
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      sport: request.params.sport,
      eventId: request.params.eventId,
      requestedFeeds: request.body.feeds,
      mockEventState: request.body.mockEventState ?? null,
    }, 'Running manual event sync');

    try {
      const result = await ingestionService.syncEventData({
        sport: request.params.sport,
        eventId: request.params.eventId,
        feeds: request.body.feeds,
        mockEventState: request.body.mockEventState,
      }, rootAdminUserId, rootAdminEmail);

      return reply.code(202).send(toProviderManualSyncSubmissionResponse(result));
    } catch (err) {
      if (err instanceof SportProviderNotFoundError) {
        logger.warn({
          sport: request.params.sport,
          eventId: request.params.eventId,
        }, 'Manual event sync failed because no providers were registered');
        return sendError(reply, 404, 'SPORT_PROVIDER_NOT_FOUND', err.message);
      }
      if (err instanceof SportSyncNotConfiguredError) {
        logger.warn({
          sport: request.params.sport,
          eventId: request.params.eventId,
        }, 'Manual event sync failed because sport is not enabled in ingestion config');
        return sendError(reply, 422, 'SPORT_SYNC_NOT_CONFIGURED', err.message);
      }
      if (err instanceof MockEventStateUnsupportedError) {
        logger.warn({
          sport: request.params.sport,
          eventId: request.params.eventId,
          mockEventState: request.body.mockEventState ?? null,
        }, 'Manual event sync failed because provider does not support mock event state controls');
        return sendError(reply, 422, 'MOCK_EVENT_STATE_UNSUPPORTED', err.message);
      }
      if (err instanceof SportEventSyncScopeError) {
        logger.warn({
          sport: request.params.sport,
          eventId: request.params.eventId,
        }, 'Manual event sync failed because a requested feed is not allowed for this event\'s syncScope');
        return sendError(reply, 409, 'SPORT_EVENT_SYNC_SCOPE_RESTRICTED', err.message);
      }
      if (err instanceof SyncRequestValidationError) {
        logger.warn({
          sport: request.params.sport,
          eventId: request.params.eventId,
          validationCode: err.code,
        }, 'Manual event sync failed validation');
        return sendError(reply, 422, 'SYNC_REQUEST_INVALID', err.message, { validationCode: err.code });
      }
      throw err;
    }
  }

  async function listUnmappedParticipants(request: FastifyRequest, reply: FastifyReply) {
    const logger = request.contextLogger ?? request.log;
    logger.debug('Listing unmapped provider participants');
    const unmapped = await ingestionService.getUnmappedParticipants();
    logger.info({ count: unmapped.length }, 'Listed unmapped provider participants');
    return reply.send({ participants: unmapped.map(toUnmappedProviderParticipantDto) });
  }

  async function cleanupStaleProviderEvents(
    request: FastifyRequest<{ Body: ProviderEventCleanupRequest }>,
    reply: FastifyReply,
  ) {
    const logger = request.contextLogger ?? request.log;
    logger.debug({ mode: request.body.mode }, 'Running stale provider event cleanup');
    const result = await ingestionService.cleanupStaleProviderEvents(request.body.mode);
    logger.info({
      mode: result.mode,
      inventoriedEventCount: result.summary.inventoriedEventCount,
      deletableEventCount: result.summary.deletableEventCount,
      deletedEventCount: result.summary.deletedEventCount,
    }, 'Ran stale provider event cleanup');
    return reply.send(mapProviderEventCleanupResultToDto(result));
  }

  // --- Provider catalog browse (plans/124 §3.4/§4.4/§5.1) ---

  async function listProviderCatalogEvents(
    request: FastifyRequest<{
      Params: { providerId: string };
      Querystring: ProviderCatalogEventListQuery;
    }>,
    reply: FastifyReply,
  ) {
    const { providerId } = request.params;
    const { sport, sportLeagueId, from, to, search } = request.query;
    try {
      const events = await eventScoreSourceService.listCandidateEvents(providerId, sport as Sport, {
        sportLeagueId,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        search,
      });
      return reply.send({ events: events.map(toProviderEventDto) });
    } catch (err) {
      if (err instanceof EventScoreSourceError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }
}
