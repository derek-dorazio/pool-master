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
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const providers = await providerService.listProviders();
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
    try {
      const detail = await providerService.getProviderDetail(request.params.providerId);
      return reply.send(detail);
    } catch (err) {
      if (err instanceof ProviderNotFoundError) {
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

    try {
      const config = await providerService.updateProviderConfig(
        providerId,
        request.body,
        rootAdminUserId,
        rootAdminEmail,
      );
      return reply.send(config);
    } catch (err) {
      if (err instanceof ProviderNotFoundError) {
        return sendError(reply, 404, 'PROVIDER_NOT_FOUND', err.message);
      }
      if (err instanceof ProviderConfigUnsupportedError) {
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

    try {
      const result = await providerService.triggerHealthCheck(
        providerId,
        rootAdminUserId,
        rootAdminEmail,
      );
      return reply.send(result);
    } catch (err) {
      if (err instanceof ProviderNotFoundError) {
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
        return sendError(reply, 404, 'SPORT_PROVIDER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Ingestion monitoring dashboard ---

  async function getIngestionDashboard(
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const dashboard = await providerService.getIngestionDashboard();
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

    try {
      const job = await providerService.reIngestEvent(
        providerId,
        eventId,
        rootAdminUserId,
        rootAdminEmail,
      );
      return reply.status(201).send(job);
    } catch (err) {
      if (err instanceof ProviderEventNotFoundError) {
        return sendError(reply, 404, 'PROVIDER_EVENT_NOT_FOUND', err.message);
      }
      if (err instanceof ProviderNotFoundError) {
        return sendError(reply, 404, 'PROVIDER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Unmapped participants ---

  async function getUnmappedParticipants(
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const unmapped = await providerService.getUnmappedParticipants();
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

    await providerService.mapParticipant(
      providerId,
      externalId,
      internalId,
      rootAdminUserId,
      rootAdminEmail,
    );
    return reply.status(204).send();
  }
}
