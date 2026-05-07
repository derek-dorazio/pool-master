/**
 * Dashboard route handlers — commissioner dashboard data.
 *
 * pool-master-rop.78.5 (folds rop.14.2 + rop.14.3) — the dashboard now
 * emits typed `LeagueSummaryDto` and `ContestSummaryDto[]` payloads
 * instead of raw domain objects, matching the typed
 * `LeagueDashboardResponseSchema`.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DashboardService } from './dashboard-service';
import { sendError } from '../../core/error-handler';
import { toLeagueSummaryDto } from '../../mappers/leagues.mapper';
import { toContestSummaryDto } from '../../mappers/contests.mapper';

export function createDashboardHandlers(dashboardService: DashboardService) {
  return {
    getDashboard,
    resolveActionItem,
  };

  async function getDashboard(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const dashboard = await dashboardService.getDashboard(request.params.id);
    if (!dashboard) {
      return sendError(reply, 404, 'LEAGUE_NOT_FOUND', 'League not found');
    }
    return reply.send({
      league: toLeagueSummaryDto(dashboard.league, {
        memberCount: dashboard.memberCount,
        activeContestCount: dashboard.contests.length,
      }),
      actionItems: dashboard.actionItems,
      contests: dashboard.contests.map((contest) => toContestSummaryDto({
        id: contest.id,
        name: contest.name,
        status: contest.status,
        contestFormat: contest.contestFormat,
        selectionType: contest.selectionType,
        scoringEngine: contest.scoringEngine,
        leagueId: contest.leagueId,
        sportEventId: contest.sportEventId,
        sport: contest.sport,
        isExclusive: contest.isExclusive,
        startsAt: contest.startsAt,
        endsAt: contest.endsAt,
        lockAt: contest.lockAt,
        createdAt: contest.createdAt,
        updatedAt: contest.updatedAt,
      })),
      memberCount: dashboard.memberCount,
      pendingInvites: dashboard.pendingInvites,
      recentMemberActivity: dashboard.recentMemberActivity,
      upcomingEvents: dashboard.upcomingEvents,
    });
  }

  async function resolveActionItem(
    request: FastifyRequest<{ Params: { id: string; itemId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const item = await dashboardService.resolveActionItem(request.params.itemId);
    return reply.send({ actionItem: item });
  }
}
