/**
 * Provider admin route handlers — request/response layer for sports data
 * provider management.
 *
 * Each handler extracts params, query, and body from the request, delegates
 * to ProviderService for business logic, and returns the appropriate response.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import type { ProviderService } from './provider-service';
import {
  ProviderConfigUnsupportedError,
  ProviderEventNotFoundError,
  ProviderNotFoundError,
  ProviderSportCoverageError,
  SportProviderNotFoundError,
} from './provider-service';
import { sendError } from '../../core/error-handler';
import { extractRootAdminContext } from './request-admin-context';

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createProviderHandlers(providerService: ProviderService) {
  return {
    listProviders,
    listSyncRuns,
    getProviderDetail,
    updateProviderConfig,
    triggerHealthCheck,
    prepareSportSync,
    getIngestionDashboard,
    reIngestEvent,
    getUnmappedParticipants,
    mapParticipant,
  };

  // --- List providers (health dashboard) ---

  async function listProviders(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const logger = request.contextLogger ?? request.log;
    logger.debug('Listing provider health summaries');
    const providers = await providerService.listProviders();
    logger.info({ count: providers.length }, 'Listed provider health summaries');
    return { items: providers };
  }

  async function listSyncRuns(
    request: FastifyRequest<{
      Querystring: {
        providerId?: string;
        sport?: Sport;
        status?: 'RUNNING' | 'COMPLETED' | 'FAILED';
        limit?: number;
      };
    }>,
    _reply: FastifyReply,
  ) {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      providerId: request.query.providerId ?? null,
      sport: request.query.sport ?? null,
      status: request.query.status ?? null,
      limit: request.query.limit ?? null,
    }, 'Listing provider sync runs');
    const syncRuns = await providerService.listSyncRuns({
      providerId: request.query.providerId,
      sport: request.query.sport,
      status: request.query.status,
      limit: request.query.limit,
    });

    return {
      items: syncRuns.map((run) => ({
        id: run.id,
        providerId: run.providerId,
        sport: run.sport,
        eventId: run.eventId,
        status: run.status,
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        createdAt: run.createdAt.toISOString(),
        payload: run.payload,
      })),
    };
  }

  // --- Provider detail ---

  async function getProviderDetail(
    request: FastifyRequest<{ Params: { providerId: string } }>,
    reply: FastifyReply,
  ) {
    const logger = request.contextLogger ?? request.log;
    logger.debug({ providerId: request.params.providerId }, 'Reading provider detail');
    try {
      const detail = await providerService.getProviderDetail(request.params.providerId);
      logger.info({ providerId: detail.providerId }, 'Read provider detail');
      return reply.send(detail);
    } catch (err) {
      if (err instanceof ProviderNotFoundError) {
        logger.warn({ providerId: request.params.providerId }, 'Provider detail not found');
        return sendError(reply, 404, 'PROVIDER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Update provider config ---

  async function updateProviderConfig(
    request: FastifyRequest<{
      Params: { providerId: string };
      Body: Record<string, unknown>;
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { providerId } = request.params;
    const logger = request.contextLogger ?? request.log;
    logger.debug({ providerId }, 'Updating provider configuration');

    try {
      const config = await providerService.updateProviderConfig(
        providerId,
        request.body,
        rootAdminUserId,
        rootAdminEmail,
      );
      logger.info({ providerId }, 'Updated provider configuration');
      return reply.send(config);
    } catch (err) {
      if (err instanceof ProviderNotFoundError) {
        logger.warn({ providerId }, 'Provider configuration update failed because provider was not found');
        return sendError(reply, 404, 'PROVIDER_NOT_FOUND', err.message);
      }
      if (err instanceof ProviderConfigUnsupportedError) {
        logger.warn({ providerId }, 'Provider configuration update unavailable for provider');
        return sendError(reply, 501, 'CONFIG_UNAVAILABLE', err.message);
      }
      throw err;
    }
  }

  // --- Trigger manual health check ---

  async function triggerHealthCheck(
    request: FastifyRequest<{ Params: { providerId: string } }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { providerId } = request.params;
    const logger = request.contextLogger ?? request.log;
    logger.debug({ providerId }, 'Triggering provider health check');

    try {
      const result = await providerService.triggerHealthCheck(
        providerId,
        rootAdminUserId,
        rootAdminEmail,
      );
      logger.info({ providerId, status: result.status }, 'Triggered provider health check');
      return reply.send(result);
    } catch (err) {
      if (err instanceof ProviderNotFoundError) {
        logger.warn({ providerId }, 'Provider health check failed because provider was not found');
        return sendError(reply, 404, 'PROVIDER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  async function prepareSportSync(
    request: FastifyRequest<{ Params: { sport: Sport } }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const logger = request.contextLogger ?? request.log;
    logger.debug({ sport: request.params.sport }, 'Preparing sport sync');

    try {
      const result = await providerService.prepareSportSync(
        request.params.sport,
        rootAdminUserId,
        rootAdminEmail,
      );
      return reply.status(201).send({
        sport: result.sport,
        providerIds: result.providerIds,
        eventsDiscovered: result.eventsDiscovered,
        eventsHydrated: result.eventsHydrated,
        participantRecordsSynced: result.participantRecordsSynced,
        rankingRecordsSynced: result.rankingRecordsSynced,
        syncRuns: result.syncRuns.map((run) => ({
          id: run.id,
          providerId: run.providerId,
          sport: run.sport,
          eventId: run.eventId,
          status: run.status,
          startedAt: run.startedAt?.toISOString() ?? null,
          completedAt: run.completedAt?.toISOString() ?? null,
          createdAt: run.createdAt.toISOString(),
          payload: run.payload,
        })),
      });
    } catch (err) {
      if (err instanceof SportProviderNotFoundError) {
        logger.warn({ sport: request.params.sport }, 'Sport sync preparation failed because no providers were registered');
        return sendError(reply, 404, 'SPORT_PROVIDER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Ingestion monitoring dashboard ---

  async function getIngestionDashboard(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const logger = request.contextLogger ?? request.log;
    logger.debug('Reading ingestion dashboard');
    const dashboard = await providerService.getIngestionDashboard();
    logger.info({
      activeJobs: dashboard.activeJobs.length,
      recentErrors: dashboard.recentErrors.length,
    }, 'Read ingestion dashboard');
    return dashboard;
  }

  // --- Re-ingest event ---

  async function reIngestEvent(
    request: FastifyRequest<{
      Params: { providerId: string; eventId: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { providerId, eventId } = request.params;
    const logger = request.contextLogger ?? request.log;
    logger.debug({ providerId, eventId }, 'Re-ingesting provider event');

    try {
      const job = await providerService.reIngestEvent(
        providerId,
        eventId,
        rootAdminUserId,
        rootAdminEmail,
      );
      logger.info({
        providerId,
        eventId,
        status: job.status,
      }, 'Re-ingested provider event');
      return reply.status(201).send(job);
    } catch (err) {
      if (err instanceof ProviderEventNotFoundError) {
        logger.warn({ providerId, eventId }, 'Provider event re-ingest failed because event detail was not found');
        return sendError(reply, 404, 'PROVIDER_EVENT_NOT_FOUND', err.message);
      }
      if (err instanceof ProviderNotFoundError) {
        logger.warn({ providerId, eventId }, 'Provider event re-ingest failed because provider was not found');
        return sendError(reply, 404, 'PROVIDER_NOT_FOUND', err.message);
      }
      if (err instanceof ProviderSportCoverageError) {
        logger.warn({ providerId, eventId }, 'Provider event re-ingest failed because provider has no sport coverage');
        return sendError(reply, 422, 'PROVIDER_SPORT_COVERAGE_REQUIRED', err.message);
      }
      throw err;
    }
  }

  // --- Unmapped participants ---

  async function getUnmappedParticipants(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const logger = request.contextLogger ?? request.log;
    logger.debug('Listing unmapped provider participants');
    const unmapped = await providerService.getUnmappedParticipants();
    logger.info({ count: unmapped.length }, 'Listed unmapped provider participants');
    return unmapped;
  }

  // --- Map participant ---

  async function mapParticipant(
    request: FastifyRequest<{
      Body: { providerId: string; externalId: string; internalId: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { providerId, externalId, internalId } = request.body;
    const logger = request.contextLogger ?? request.log;
    logger.debug({ providerId, externalId, internalId }, 'Mapping provider participant');

    await providerService.mapParticipant(
      providerId,
      externalId,
      internalId,
      rootAdminUserId,
      rootAdminEmail,
    );
    logger.info({ providerId, externalId, internalId }, 'Mapped provider participant');
    return reply.status(204).send();
  }
}
