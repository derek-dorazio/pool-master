/**
 * Search & Discovery module — participant search, league/contest discovery.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { SearchService } from './search-service';

export async function searchModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const searchService = new SearchService(prisma);

  // --- Participant Search (Phase 1 — PostgreSQL full-text) ---

  fastify.get<{
    Querystring: {
      q?: string;
      sportId?: string;
      status?: string;
      position?: string;
      team?: string;
      nationality?: string;
      sortBy?: string;
      limit?: string;
      offset?: string;
    };
  }>('/participants', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          sportId: { type: 'string' },
          status: { type: 'string' },
          position: { type: 'string' },
          team: { type: 'string' },
          nationality: { type: 'string' },
          sortBy: { type: 'string', enum: ['RELEVANCE', 'RANKING', 'NAME', 'PRICE', 'FORM'] },
          limit: { type: 'string' },
          offset: { type: 'string' },
        },
      },
    },
    handler: async (request) => {
      const qs = request.query;
      return searchService.searchParticipants({
        query: qs.q ?? '',
        sportId: qs.sportId,
        status: qs.status ? qs.status.split(',') : undefined,
        position: qs.position ? qs.position.split(',') : undefined,
        teamAffiliation: qs.team ? qs.team.split(',') : undefined,
        nationality: qs.nationality ? qs.nationality.split(',') : undefined,
        sortBy: qs.sortBy as 'RELEVANCE' | 'RANKING' | 'NAME' | undefined,
        limit: qs.limit ? parseInt(qs.limit, 10) : undefined,
        offset: qs.offset ? parseInt(qs.offset, 10) : undefined,
      });
    },
  });

  // --- Discovery: Browse Public Leagues ---

  fastify.get<{
    Querystring: {
      q?: string;
      sport?: string;
      sort?: string;
      limit?: string;
      offset?: string;
    };
  }>('/discover/leagues', {
    handler: async (request) => {
      const qs = request.query;
      return searchService.searchLeagues({
        query: qs.q,
        sport: qs.sport,
        sortBy: (qs.sort ?? 'POPULAR') as 'POPULAR' | 'NEWEST' | 'ACTIVITY',
        limit: qs.limit ? parseInt(qs.limit, 10) : undefined,
        offset: qs.offset ? parseInt(qs.offset, 10) : undefined,
      });
    },
  });

  // --- Discovery: Browse Open Contests ---

  fastify.get<{
    Querystring: {
      q?: string;
      sport?: string;
      sort?: string;
      limit?: string;
      offset?: string;
    };
  }>('/discover/contests', {
    handler: async (request) => {
      const qs = request.query;
      return searchService.searchContests({
        query: qs.q,
        sport: qs.sport,
        sortBy: (qs.sort ?? 'STARTING_SOON') as 'STARTING_SOON' | 'POPULAR' | 'PRIZE_POOL',
        limit: qs.limit ? parseInt(qs.limit, 10) : undefined,
        offset: qs.offset ? parseInt(qs.offset, 10) : undefined,
      });
    },
  });

  // --- Discovery: Report ---

  fastify.post<{
    Body: { entityType: string; entityId: string; reason: string };
  }>('/discover/report', {
    schema: {
      body: {
        type: 'object',
        required: ['entityType', 'entityId', 'reason'],
        properties: {
          entityType: { type: 'string', enum: ['LEAGUE', 'CONTEST'] },
          entityId: { type: 'string' },
          reason: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = request.headers['x-user-id'] as string;
      const report = await prisma.discoveryReport.create({
        data: {
          entityType: request.body.entityType,
          entityId: request.body.entityId,
          reportedBy: userId,
          reason: request.body.reason,
        },
      });

      // Auto-hide after threshold reports
      const reportCount = await prisma.discoveryReport.count({
        where: {
          entityType: request.body.entityType,
          entityId: request.body.entityId,
          status: 'PENDING',
        },
      });

      if (reportCount >= 3) {
        if (request.body.entityType === 'LEAGUE') {
          await prisma.discoverableLeague.update({
            where: { id: request.body.entityId },
            data: { isHidden: true },
          });
        }
      }

      return reply.status(201).send({ report: { id: report.id }, reportCount });
    },
  });
}
