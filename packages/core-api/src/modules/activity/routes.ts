/**
 * Activity module (#1819) — one grid over every background job. Mounted at /api/v1/activity.
 * Root admin only.
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ActivityListQuery, ActivityListResponse, ApiErrorCode } from '@poolmaster/shared/dto';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/activity.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { toActivityJobDto } from '../../mappers';
import type { ActivityService } from './activity-service';

export interface ActivityModuleOptions {
  activity: ActivityService;
}

/**
 * Activity reads one address may make a minute. A grid refreshing every few seconds stays well
 * inside it; a script hammering the read does not. Per process, as the other per-address limits.
 */
export const ACTIVITY_READS_PER_MINUTE = 60;

/** An address over its Activity reads for the minute. */
export class ActivityRateLimitError extends Error {
  readonly statusCode = 429;
  readonly code: ApiErrorCode = 'ACTIVITY_RATE_LIMITED';

  constructor() {
    super('Too many Activity reads from this address; try again in a minute.');
    this.name = 'ActivityRateLimitError';
  }
}

export async function activityModule(fastify: FastifyInstance, opts: ActivityModuleOptions): Promise<void> {
  void fastify.register(schemaComponentsPlugin);
  // Only the routes that ask for a limit get one (`config.rateLimit`); keyed by `request.ip`.
  // Awaited, so its route hook is in place before the routes below are declared.
  await fastify.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new ActivityRateLimitError(),
  });
  fastify.addHook('onRequest', requireRootAdmin);

  const envelope = schemaRef('ErrorEnvelope');

  fastify.get('/', {
    schema: {
      tags: ['Activity'],
      summary: 'List background jobs for the Activity grid',
      description: 'Every background job queued inside a window (syncs, emails, settlements, releases and the rest), filtered by kind, status, sport league and event, newest first. '
        + 'Nothing pages the result; the filters narrow it. `to` defaults to now; `from` to 24 hours before it, or to 30 days before it (every job kept) when a sportLeagueId or sportEventId narrows the read. '
        + 'A `from` after `to` answers 400 ACTIVITY_WINDOW_INVALID; more than 60 reads a minute from one address answer 429 ACTIVITY_RATE_LIMITED. A league\'s activity is its own jobs and the jobs on any of its events. Each sync job names the sync runs it ran; read one with getProviderSyncRun.',
      operationId: 'listActivity',
      querystring: schemaRef('ActivityListQuery'),
      response: { 200: schemaRef('ActivityListResponse'), 400: envelope, 401: envelope, 403: envelope, 429: envelope },
    },
    config: { rateLimit: { max: ACTIVITY_READS_PER_MINUTE, timeWindow: 60_000 } },
    handler: async (request: FastifyRequest<{ Querystring: ActivityListQuery }>): Promise<ActivityListResponse> => {
      const { kind, status, sportLeagueId, sportEventId, from, to } = request.query;
      const jobs = await opts.activity.list({
        kind,
        status,
        sportLeagueId,
        sportEventId,
        from: from === undefined ? undefined : new Date(from),
        to: to === undefined ? undefined : new Date(to),
      });
      return { jobs: jobs.map(({ job, syncRunIds }) => toActivityJobDto(job, syncRunIds)) };
    },
  });
}
