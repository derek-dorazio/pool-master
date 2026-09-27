/**
 * Dashboard route handlers — commissioner dashboard data.
 *
 * Emits typed `LeagueDto` and `ContestSummaryDto[]` payloads rather than raw domain objects,
 * matching `LeagueDashboardResponseSchema`. League-scoped, so no viewer context (A8).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DashboardService } from './dashboard-service';
import { sendError } from '../../core/error-handler';
import { toLeagueDto } from '../../mappers/leagues.mapper';
import { toContestSummaryDto } from '../../mappers/contests.mapper';

export function createDashboardHandlers(dashboardService: DashboardService) {
  return {
    getDashboard,
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
      league: toLeagueDto(dashboard.league, {
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
}
