/**
 * Search & Discovery module — participant search, league/contest discovery.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { SearchService } from './search-service';
import {
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import {
  SearchResultsResponseSchema,
  DiscoverLeaguesResponseSchema,
  DiscoverContestsResponseSchema,
  DiscoveryReportResponseSchema,
} from '@poolmaster/shared/dto/search.dto';
import {
  mapDiscoverableContestToDto,
  mapDiscoverableLeagueToDto,
  mapSearchParticipantsResponseToDto,
} from '../../mappers';

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
      tags: ['Search'],
      summary: 'Search participants with filters',
      operationId: 'searchParticipants',
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
      response: { 200: zodToJsonSchema(SearchResultsResponseSchema) },
    },
    handler: async (request) => {
      const qs = request.query;
      const result = await searchService.searchParticipants({
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
      return mapSearchParticipantsResponseToDto(result);
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
    schema: {
      tags: ['Search'],
      summary: 'Discover public leagues',
      operationId: 'discoverLeagues',
      response: { 200: zodToJsonSchema(DiscoverLeaguesResponseSchema) },
    },
    handler: async (request) => {
      const qs = request.query;
      const result = await searchService.searchLeagues({
        query: qs.q,
        sport: qs.sport,
        sortBy: (qs.sort ?? 'POPULAR') as 'POPULAR' | 'NEWEST' | 'ACTIVITY',
        limit: qs.limit ? parseInt(qs.limit, 10) : undefined,
        offset: qs.offset ? parseInt(qs.offset, 10) : undefined,
      });
      return {
        leagues: result.leagues.map((league) =>
          mapDiscoverableLeagueToDto(league as Record<string, unknown>),
        ),
        total: result.total,
      };
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
    schema: {
      tags: ['Search'],
      summary: 'Discover open contests',
      operationId: 'discoverContests',
      response: { 200: zodToJsonSchema(DiscoverContestsResponseSchema) },
    },
    handler: async (request) => {
      const qs = request.query;
      const result = await searchService.searchContests({
        query: qs.q,
        sport: qs.sport,
        sortBy: (qs.sort ?? 'STARTING_SOON') as 'STARTING_SOON' | 'POPULAR' | 'PRIZE_POOL',
        limit: qs.limit ? parseInt(qs.limit, 10) : undefined,
        offset: qs.offset ? parseInt(qs.offset, 10) : undefined,
      });
      return {
        contests: result.contests.map((contest) =>
          mapDiscoverableContestToDto(contest as Record<string, unknown>),
        ),
        total: result.total,
      };
    },
  });

  // --- Discovery: Report ---

  fastify.post<{
    Body: { entityType: string; entityId: string; reason: string };
  }>('/discover/report', {
    schema: {
      tags: ['Search'],
      summary: 'Report a league or contest',
      operationId: 'reportDiscoveryEntity',
      response: { 201: zodToJsonSchema(DiscoveryReportResponseSchema) },
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
