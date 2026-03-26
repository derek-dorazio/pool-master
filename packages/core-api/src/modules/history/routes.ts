/**
 * History module — contest history endpoints.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { HistoryService } from './history-service';
import { LeagueHistoryService } from './league-history-service';
import { TimelineService } from './timeline-service';

export async function historyModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const historyService = new HistoryService(prisma);
  const timelineService = new TimelineService(prisma);
  const leagueHistoryService = new LeagueHistoryService(prisma);

  // GET /contests/:id/history/summary
  fastify.get<{ Params: { id: string } }>(
    '/contests/:id/history/summary',
    async (request, reply) => {
      const summary = await historyService.getContestSummary(request.params.id);
      if (!summary) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'No history for this contest' });
      }
      return reply.send(summary);
    },
  );

  // GET /contests/:id/history/standings
  fastify.get<{ Params: { id: string } }>(
    '/contests/:id/history/standings',
    async (request) => {
      const standings = await historyService.getContestStandings(request.params.id);
      return { standings };
    },
  );

  // GET /contests/:id/history/roster/:entryId
  fastify.get<{ Params: { id: string; entryId: string } }>(
    '/contests/:id/history/roster/:entryId',
    async (request, reply) => {
      const roster = await historyService.getRosterHistory(
        request.params.id,
        request.params.entryId,
      );
      if (!roster) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Roster history not found' });
      }
      return reply.send({ rosterHistory: roster });
    },
  );

  // GET /contests/:id/history/payouts
  fastify.get<{ Params: { id: string } }>(
    '/contests/:id/history/payouts',
    async (request) => {
      const payouts = await historyService.getContestPayouts(request.params.id);
      return { payouts };
    },
  );

  // GET /leagues/:id/history/results
  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/history/results',
    async (request) => {
      const results = await historyService.getLeagueResults(request.params.id);
      return { results };
    },
  );

  // GET /leagues/:id/history/members/:mid/results
  fastify.get<{ Params: { id: string; mid: string } }>(
    '/leagues/:id/history/members/:mid/results',
    async (request) => {
      const results = await historyService.getMemberResults(request.params.mid);
      return { results };
    },
  );

  // --- Scoring Timeline & Replays (Phase 3) ---

  // GET /contests/:id/history/timeline
  fastify.get<{ Params: { id: string } }>(
    '/contests/:id/history/timeline',
    async (request) => {
      const timeline = await timelineService.getTimeline(request.params.id);
      return timeline;
    },
  );

  // GET /contests/:id/history/draft
  fastify.get<{ Params: { id: string } }>(
    '/contests/:id/history/draft',
    async (request, reply) => {
      const replay = await timelineService.getDraftReplay(request.params.id);
      if (!replay) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'No draft history for this contest' });
      }
      return reply.send(replay);
    },
  );

  // GET /contests/:id/history/roster/:entryId (detailed replay)
  fastify.get<{ Params: { id: string; entryId: string } }>(
    '/contests/:id/history/replay/:entryId',
    async (request, reply) => {
      const replay = await timelineService.getRosterReplay(
        request.params.id,
        request.params.entryId,
      );
      if (!replay) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Roster replay not found' });
      }
      return reply.send(replay);
    },
  );

  // --- League History (Phase 2) ---

  // GET /leagues/:id/history/seasons
  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/history/seasons',
    async (request) => {
      const seasons = await leagueHistoryService.getSeasonSummaries(request.params.id);
      return { seasons };
    },
  );

  // GET /leagues/:id/history/seasons/:sid
  fastify.get<{ Params: { id: string; sid: string } }>(
    '/leagues/:id/history/seasons/:sid',
    async (request, reply) => {
      const summary = await leagueHistoryService.getSeasonSummary(
        request.params.id,
        request.params.sid,
      );
      if (!summary) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Season summary not found' });
      }
      return reply.send(summary);
    },
  );

  // GET /leagues/:id/history/champions
  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/history/champions',
    async (request) => {
      const champions = await leagueHistoryService.getChampionList(request.params.id);
      return { champions };
    },
  );

  // GET /leagues/:id/history/members/:mid/stats
  fastify.get<{ Params: { id: string; mid: string } }>(
    '/leagues/:id/history/members/:mid/stats',
    async (request, reply) => {
      const stats = await leagueHistoryService.getMemberStats(request.params.mid);
      if (!stats) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'No stats for this member' });
      }
      return reply.send(stats);
    },
  );

  // GET /leagues/:id/history/leaderboard
  fastify.get<{ Params: { id: string }; Querystring: { sortBy?: string } }>(
    '/leagues/:id/history/leaderboard',
    async (request) => {
      const sortBy = (request.query.sortBy ?? 'WINS') as 'WINS' | 'POINTS' | 'WINNINGS';
      const leaderboard = await leagueHistoryService.getAllTimeLeaderboard(
        request.params.id,
        sortBy,
      );
      return { leaderboard };
    },
  );

  // GET /leagues/:id/history/trophies/:mid
  fastify.get<{ Params: { id: string; mid: string } }>(
    '/leagues/:id/history/trophies/:mid',
    async (request) => {
      const trophies = await leagueHistoryService.getMemberTrophies(
        request.params.id,
        request.params.mid,
      );
      return { trophies };
    },
  );
}
