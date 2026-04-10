/**
 * Provider admin route handlers — request/response layer for sports data
 * provider management.
 *
 * Each handler extracts params, query, and body from the request, delegates
 * to ProviderService for business logic, and returns the appropriate response.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProviderService } from './provider-service';
import {
  ProviderConfigUnsupportedError,
  ProviderEventNotFoundError,
  ProviderNotFoundError,
} from './provider-service';
import { sendError } from '../../core/error-handler';
import { extractRootAdminContext } from './request-admin-context';

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createProviderHandlers(providerService: ProviderService) {
  return {
    listProviders,
    getProviderDetail,
    updateProviderConfig,
    triggerHealthCheck,
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
