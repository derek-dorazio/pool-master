/** The route handler for a league's event email settings (#851). */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UpdateLeagueEventEmailSettingsRequest } from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import { toLeagueDto } from '../../mappers/leagues.mapper';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';
import type { LeagueEventEmailSettingsService } from './event-email-settings-service';
import { LeagueNotFoundError, LeagueOperationError } from './service';

export function createLeagueEventEmailSettingsHandler(
  settings: LeagueEventEmailSettingsService,
  planEntitlements: PlanEntitlementsService,
) {
  return async function updateLeagueEventEmailSettings(
    request: FastifyRequest<{
      Params: { id: string };
      Body: UpdateLeagueEventEmailSettingsRequest;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    try {
      const league = await settings.update(request.params.id, request.body);
      return reply.send({ league: toLeagueDto(league, planEntitlements.forPlan(league.plan)) });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        logger.warn({
          action: 'leagueRoute.updateEventEmailSettings.notFound',
          data: { leagueId: request.params.id },
        }, 'Cannot update event email settings for missing league');
        return sendError(reply, 404, 'LEAGUE_NOT_FOUND', err.message);
      }
      if (err instanceof LeagueOperationError) {
        logger.warn({
          action: 'leagueRoute.updateEventEmailSettings.invalid',
          data: { leagueId: request.params.id, errorCode: err.code },
        }, 'Rejected league event email settings update');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  };
}
