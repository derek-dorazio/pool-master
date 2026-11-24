/**
 * Sync findings routes (#1999, league model 2), mounted at /api/v1/ingestion/sync-findings: the
 * root admin's Findings list, one finding, and the actions on one. Root admin only.
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply } from 'fastify';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
// Registers the named components these routes $ref.
import '@poolmaster/shared/dto/sync-findings.dto';
import type { ApiErrorCode, ChangeProviderSyncFindingStatusRequest, MapProviderSyncFindingParticipantRequest } from '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { requireRootAdmin } from '../../../core/root-admin-guard';
import { sendError } from '../../../core/error-handler';
import { toProviderSyncFindingDto } from '../../../mappers/sync-findings.mapper';
import { requireAuthUser } from '../../../plugins/auth-guard';
import { schemaComponentsPlugin } from '../../../plugins/schema-components';
import { ParticipantNotFoundError } from '../../participants/service';
import { ProviderSyncFindingError, type ProviderSyncFindingService } from './provider-sync-finding-service';

export interface SyncFindingsModuleOptions {
  syncFindings: ProviderSyncFindingService;
}

const FINDING_PARAMS = {
  type: 'object',
  required: ['findingId'],
  properties: { findingId: { type: 'string', format: 'uuid', description: 'The finding (ProviderSyncFindingDto.id).' } },
} as const;

/**
 * Findings requests one address may make a minute. The grid reloading after each action stays
 * well inside it; a script hammering the routes does not. Per process, as the other per-address
 * limits.
 */
export const SYNC_FINDINGS_REQUESTS_PER_MINUTE = 60;

/** An address over its Findings requests for the minute. */
export class SyncFindingsRateLimitError extends Error {
  readonly statusCode = 429;
  readonly code: ApiErrorCode = 'SYNC_FINDINGS_RATE_LIMITED';

  constructor() {
    super('Too many sync findings requests from this address; try again in a minute.');
    this.name = 'SyncFindingsRateLimitError';
  }
}

const RATE_LIMITED = ` More than ${String(SYNC_FINDINGS_REQUESTS_PER_MINUTE)} requests a minute from one address answer 429 SYNC_FINDINGS_RATE_LIMITED.`;

export async function syncFindingsModule(fastify: FastifyInstance, opts: SyncFindingsModuleOptions): Promise<void> {
  void fastify.register(schemaComponentsPlugin);
  // Only the routes that ask for a limit get one (`config.rateLimit`); keyed by `request.ip`.
  // Awaited, so its route hook is in place before the routes below are declared.
  await fastify.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new SyncFindingsRateLimitError(),
  });
  fastify.addHook('onRequest', requireRootAdmin);

  const envelope = schemaRef('ErrorEnvelope');
  const errors = (...statuses: number[]) =>
    Object.fromEntries([401, 403, 429, ...statuses].map((status) => [status, envelope]));
  const config = { rateLimit: { max: SYNC_FINDINGS_REQUESTS_PER_MINUTE, timeWindow: 60_000 } };

  /** A finding error answers with its own status and code; anything else is the global handler's. */
  function sendFindingError(reply: FastifyReply, err: unknown) {
    if (err instanceof ProviderSyncFindingError) return sendError(reply, err.statusCode, err.code, err.message);
    if (err instanceof ParticipantNotFoundError) return sendError(reply, err.statusCode, err.code, err.message);
    throw err;
  }

  fastify.get('/', {
    schema: {
      tags: ['Ingestion'],
      summary: 'List sync findings',
      description: 'Every sync finding kept, most recently seen first, each with its sport league, event, Provider and the actions it offers now (#1999). Nothing pages it: a resolved finding is deleted 90 days after it was resolved; open and waived ones are kept.' + RATE_LIMITED,
      operationId: 'listProviderSyncFindings',
      response: { 200: schemaRef('ProviderSyncFindingListResponse'), ...errors() },
    },
    config,
  }, async (request, reply) => {
    const findings = await opts.syncFindings.list();
    request.log.info({ action: 'ingestion.syncFindings.listed', count: findings.length }, 'Listed sync findings');
    return reply.send({ findings: findings.map(toProviderSyncFindingDto) });
  });

  fastify.get<{ Params: { findingId: string } }>('/:findingId', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Get a sync finding',
      description: 'One sync finding, as the Findings list has it. 404 SYNC_FINDING_NOT_FOUND.' + RATE_LIMITED,
      operationId: 'getProviderSyncFinding',
      params: FINDING_PARAMS,
      response: { 200: schemaRef('ProviderSyncFindingResponse'), ...errors(404) },
    },
    config,
  }, async (request, reply) => {
    try {
      return reply.send({ finding: toProviderSyncFindingDto(await opts.syncFindings.get(request.params.findingId)) });
    } catch (err) {
      return sendFindingError(reply, err);
    }
  });

  fastify.post<{ Params: { findingId: string }; Body: ChangeProviderSyncFindingStatusRequest }>('/:findingId/status', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Resolve, waive or reopen a sync finding',
      description: 'Takes one of the finding\'s offered actions: RESOLVE, WAIVE with a note, or REOPEN (#1999). '
        + '404 SYNC_FINDING_NOT_FOUND. 409 SYNC_FINDING_ACTION_NOT_OFFERED when the finding does not offer the action now. 422 SYNC_FINDING_WAIVE_NOTE_REQUIRED for WAIVE with no note.' + RATE_LIMITED,
      operationId: 'changeProviderSyncFindingStatus',
      params: FINDING_PARAMS,
      body: schemaRef('ChangeProviderSyncFindingStatusRequest'),
      response: { 200: schemaRef('ProviderSyncFindingResponse'), ...errors(400, 404, 409, 422) },
    },
    config,
  }, async (request, reply) => {
    try {
      const finding = await opts.syncFindings.changeStatus(request.params.findingId, {
        action: request.body.action,
        waiveNote: request.body.waiveNote ?? null,
        userId: requireAuthUser(request).userId,
      });
      return reply.send({ finding: toProviderSyncFindingDto(finding) });
    } catch (err) {
      return sendFindingError(reply, err);
    }
  });

  fastify.post<{ Params: { findingId: string }; Body: MapProviderSyncFindingParticipantRequest }>('/:findingId/participant-mapping', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Map an unmapped participant finding to a participant',
      description: 'An OPEN UNMAPPED_PARTICIPANT finding\'s fix (#1999): maps the feed\'s participant id (providerValue) from its Provider to a participant of its sport league, as bindParticipantProviderMapping does, and resolves the finding. '
        + '404 SYNC_FINDING_NOT_FOUND or PARTICIPANT_NOT_FOUND. 409 SYNC_FINDING_ACTION_NOT_OFFERED when the finding does not offer MAP_PARTICIPANT now. 422 SYNC_FINDING_PARTICIPANT_OTHER_LEAGUE for a participant of another league.' + RATE_LIMITED,
      operationId: 'mapProviderSyncFindingParticipant',
      params: FINDING_PARAMS,
      body: schemaRef('MapProviderSyncFindingParticipantRequest'),
      response: { 200: schemaRef('ProviderSyncFindingResponse'), ...errors(400, 404, 409, 422) },
    },
    config,
  }, async (request, reply) => {
    try {
      const finding = await opts.syncFindings.mapParticipant(request.params.findingId, {
        participantId: request.body.participantId,
        userId: requireAuthUser(request).userId,
      });
      return reply.send({ finding: toProviderSyncFindingDto(finding) });
    } catch (err) {
      return sendFindingError(reply, err);
    }
  });
}
