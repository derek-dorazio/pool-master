/**
 * History module — contest history endpoints.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { HistoryService } from './history-service';
import { LeagueHistoryService } from './league-history-service';
import { TimelineService } from './timeline-service';
import { RecordsEngine } from './records-engine';
import { RivalryEngine } from './rivalry-engine';
import { AnalyticsService } from './analytics-engine';
import { YearOverYearTracker } from './yoy-tracker';
import { SeasonNotesService } from './season-notes-service';
import { ImportService } from './import-service';
import { HistoryMergeService } from './member-merge';
import { HistoryExportService } from './export-service';
import { RetentionService } from './retention-service';

export async function historyModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const historyService = new HistoryService(prisma);
  const timelineService = new TimelineService(prisma);
  const recordsEngine = new RecordsEngine(prisma);
  const rivalryEngine = new RivalryEngine(prisma);
  const analyticsService = new AnalyticsService(prisma);
  const leagueHistoryService = new LeagueHistoryService(prisma);
  const yoyTracker = new YearOverYearTracker(prisma);
  const seasonNotesService = new SeasonNotesService(prisma);
  const importService = new ImportService(prisma);
  const mergeService = new HistoryMergeService(prisma);
  const exportService = new HistoryExportService(prisma);
  const retentionService = new RetentionService(prisma);

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

  // --- Records & Rivalries (Phase 4) ---

  // GET /leagues/:id/history/records
  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/history/records',
    async (request) => {
      const records = await recordsEngine.getRecords(request.params.id);
      return { records };
    },
  );

  // GET /leagues/:id/history/records/:category
  fastify.get<{ Params: { id: string; category: string } }>(
    '/leagues/:id/history/records/:category',
    async (request, reply) => {
      const record = await recordsEngine.getRecord(request.params.id, request.params.category);
      if (!record) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Record not found' });
      }
      return reply.send(record);
    },
  );

  // POST /leagues/:id/history/records/recompute (admin)
  fastify.post<{ Params: { id: string } }>(
    '/leagues/:id/history/records/recompute',
    async (request) => {
      const count = await recordsEngine.recomputeAllRecords(request.params.id);
      return { recordsComputed: count };
    },
  );

  // GET /leagues/:id/history/rivalries
  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/history/rivalries',
    async (request) => {
      const rivalries = await rivalryEngine.getRivalries(request.params.id);
      return { rivalries };
    },
  );

  // GET /leagues/:id/history/rivalries/:mid1/:mid2
  fastify.get<{ Params: { id: string; mid1: string; mid2: string } }>(
    '/leagues/:id/history/rivalries/:mid1/:mid2',
    async (request, reply) => {
      const rivalry = await rivalryEngine.getRivalry(
        request.params.id,
        request.params.mid1,
        request.params.mid2,
      );
      if (!rivalry) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'No rivalry record found' });
      }
      return reply.send(rivalry);
    },
  );

  // POST /leagues/:id/history/rivalries/recompute (admin)
  fastify.post<{ Params: { id: string } }>(
    '/leagues/:id/history/rivalries/recompute',
    async (request) => {
      const count = await rivalryEngine.recomputeRivalries(request.params.id);
      return { rivalriesComputed: count };
    },
  );

  // --- Analytics (Phase 5) ---

  // GET /leagues/:id/history/analytics/luck
  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/history/analytics/luck',
    async (request) => {
      const scores = await analyticsService.computeLuckScores(request.params.id);
      return { luckScores: scores };
    },
  );

  // GET /leagues/:id/history/analytics/power
  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/history/analytics/power',
    async (request) => {
      const ratings = await analyticsService.computePowerRatings(request.params.id);
      return { powerRatings: ratings };
    },
  );

  // GET /leagues/:id/history/analytics/consistency
  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/history/analytics/consistency',
    async (request) => {
      const scores = await analyticsService.computeConsistencyScores(request.params.id);
      return { consistencyScores: scores };
    },
  );

  // POST /leagues/:id/history/analytics/trophies (admin — award analytics trophies)
  fastify.post<{ Params: { id: string }; Querystring: { seasonId?: string } }>(
    '/leagues/:id/history/analytics/trophies',
    async (request) => {
      const count = await analyticsService.awardAnalyticsTrophies(
        request.params.id,
        request.query.seasonId,
      );
      return { trophiesAwarded: count };
    },
  );

  // --- Year-over-Year Improvement (Phase 5/6) ---

  // GET /members/:mid/history/yoy
  fastify.get<{ Params: { mid: string }; Querystring: { sport?: string } }>(
    '/members/:mid/history/yoy',
    async (request) => {
      const stats = await yoyTracker.getYoYStats(request.params.mid, request.query.sport);
      return stats;
    },
  );

  // GET /leagues/:id/history/improvement-rankings
  fastify.get<{ Params: { id: string }; Querystring: { season: string } }>(
    '/leagues/:id/history/improvement-rankings',
    async (request, reply) => {
      const season = request.query.season;
      if (!season) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'season query param required' });
      }
      const rankings = await yoyTracker.getImprovementRankings(request.params.id, season);
      return { rankings };
    },
  );

  // --- Season Notes & Custom Trophies (Phase 6) ---

  // POST /leagues/:id/seasons/:season/notes
  fastify.post<{ Params: { id: string; season: string }; Body: { content: string; authorId: string } }>(
    '/leagues/:id/seasons/:season/notes',
    async (request) => {
      const note = await seasonNotesService.addNote(
        request.params.id,
        request.params.season,
        request.body.content,
        request.body.authorId,
      );
      return note;
    },
  );

  // GET /leagues/:id/seasons/:season/notes
  fastify.get<{ Params: { id: string; season: string } }>(
    '/leagues/:id/seasons/:season/notes',
    async (request) => {
      const notes = await seasonNotesService.getNotes(request.params.id, request.params.season);
      return { notes };
    },
  );

  // POST /leagues/:id/seasons/:season/trophies
  fastify.post<{
    Params: { id: string; season: string };
    Body: { label: string; description?: string; recipientMemberId: string; awardedBy: string };
  }>(
    '/leagues/:id/seasons/:season/trophies',
    async (request) => {
      const trophy = await seasonNotesService.awardTrophy(
        request.params.id,
        request.params.season,
        request.body,
      );
      return trophy;
    },
  );

  // GET /leagues/:id/trophies (custom trophies)
  fastify.get<{ Params: { id: string }; Querystring: { season?: string } }>(
    '/leagues/:id/custom-trophies',
    async (request) => {
      const trophies = await seasonNotesService.getTrophies(
        request.params.id,
        request.query.season,
      );
      return { trophies };
    },
  );

  // --- Manual Season Import (Phase 6) ---

  // POST /leagues/:id/import-season
  fastify.post<{
    Params: { id: string };
    Body: { data: { season: string; year: number; sport: string; contests: unknown[] }; importedBy: string };
  }>(
    '/leagues/:id/import-season',
    async (request, reply) => {
      const { data, importedBy } = request.body;
      const validation = await importService.validateImport(request.params.id, data as any);
      if (!validation.isValid) {
        return reply.status(400).send({ error: 'VALIDATION_FAILED', validation });
      }
      const result = await importService.executeImport(request.params.id, data as any, importedBy);
      return result;
    },
  );

  // --- Member Merge (Phase 6) ---

  // POST /members/merge/preview
  fastify.post<{ Body: { primaryMemberId: string; duplicateMemberId: string } }>(
    '/members/merge/preview',
    async (request) => {
      const preview = await mergeService.previewMerge(
        request.body.primaryMemberId,
        request.body.duplicateMemberId,
      );
      return preview;
    },
  );

  // POST /members/merge/execute
  fastify.post<{ Body: { primaryMemberId: string; duplicateMemberId: string } }>(
    '/members/merge/execute',
    async (request) => {
      const result = await mergeService.executeMerge(
        request.body.primaryMemberId,
        request.body.duplicateMemberId,
      );
      return result;
    },
  );

  // --- Data Export (Phase 6) ---

  // GET /leagues/:id/export
  fastify.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/leagues/:id/export',
    async (request, reply) => {
      const format = request.query.format ?? 'json';
      if (format === 'csv') {
        const csvFiles = await exportService.exportLeagueCsv(request.params.id);
        return reply.send({ files: csvFiles });
      }
      const data = await exportService.exportLeagueJson(request.params.id);
      return reply.send(data);
    },
  );

  // GET /members/:mid/export
  fastify.get<{ Params: { mid: string } }>(
    '/members/:mid/export',
    async (request) => {
      const data = await exportService.exportMemberHistory(request.params.mid);
      return data;
    },
  );

  // --- Retention Configuration (Phase 6) ---

  // GET /leagues/:id/retention
  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/retention',
    async (request) => {
      const config = await retentionService.getConfig(request.params.id);
      return config;
    },
  );

  // PUT /leagues/:id/retention
  fastify.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/leagues/:id/retention',
    async (request) => {
      const config = await retentionService.updateConfig(request.params.id, request.body as any);
      return config;
    },
  );

  // POST /leagues/:id/retention/preview-cleanup
  fastify.post<{ Params: { id: string } }>(
    '/leagues/:id/retention/preview-cleanup',
    async (request) => {
      const preview = await retentionService.previewCleanup(request.params.id);
      return preview;
    },
  );
}
