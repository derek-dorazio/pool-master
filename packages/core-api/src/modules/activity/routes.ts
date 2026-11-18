/**
 * Activity module (#1819) — one grid over every background job. Mounted at /api/v1/activity.
 * Root admin only.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ActivityListQuery, ActivityListResponse } from '@poolmaster/shared/dto';
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

export function activityModule(fastify: FastifyInstance, opts: ActivityModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);
  fastify.addHook('onRequest', requireRootAdmin);

  const envelope = schemaRef('ErrorEnvelope');

  fastify.get('/', {
    schema: {
      tags: ['Activity'],
      summary: 'List background jobs for the Activity grid',
      description: 'Every background job queued inside a window (syncs, emails, settlements, releases and the rest), filtered by kind, status, sport league and event, newest first. '
        + 'Nothing pages the result; the filters narrow it. `to` defaults to now; `from` to 24 hours before it, or to 30 days before it (every job kept) when a sportLeagueId or sportEventId narrows the read. '
        + 'A league\'s activity is its own jobs and the jobs on any of its events. Each sync job names the sync runs it ran; read one with getProviderSyncRun.',
      operationId: 'listActivity',
      querystring: schemaRef('ActivityListQuery'),
      response: { 200: schemaRef('ActivityListResponse'), 401: envelope, 403: envelope },
    },
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
