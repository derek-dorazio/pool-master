/**
 * Which sport leagues' upcoming events a league's commissioners are emailed about (#851): "Coming
 * up soon" (C1) and "Ready for contests" (C2). A league setting, set by its commissioners; a new
 * league hears about every sport league.
 */

import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import type { LeagueRepository, SportLeagueRepository } from '@poolmaster/shared/db';
import type { League } from '@poolmaster/shared/domain';
import type { UpdateLeagueEventEmailSettingsRequest } from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import { toLeagueDto } from '../../mappers/leagues.mapper';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';
import { LeagueNotFoundError, LeagueOperationError } from './service';

export interface LeagueEventEmailSettingsDeps {
  leagues: Pick<LeagueRepository, 'findById' | 'update'>;
  sportLeagues: Pick<SportLeagueRepository, 'findAll'>;
  logger?: FastifyBaseLogger;
}

export class LeagueEventEmailSettings {
  constructor(private readonly deps: LeagueEventEmailSettingsDeps) {}

  /** Replaces the league's muted sport leagues. Each id must be a sport league; repeats count once. */
  async update(leagueId: string, updates: UpdateLeagueEventEmailSettingsRequest): Promise<League> {
    const league = await this.deps.leagues.findById(leagueId);
    if (!league) throw new LeagueNotFoundError(leagueId);
    if (!league.isActive) {
      throw new LeagueOperationError(
        'Inactive leagues are read-only outside lifecycle actions',
        'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE',
      );
    }
    const muted = [...new Set(updates.mutedSportLeagueIds)];
    const known = new Set((await this.deps.sportLeagues.findAll({})).map((sportLeague) => sportLeague.id));
    const unknown = muted.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      this.deps.logger?.warn({
        action: 'league.updateEventEmailSettings.unknownSportLeague',
        data: { leagueId, unknown },
      }, 'Rejected event email settings naming an unknown sport league');
      throw new LeagueOperationError(`Not a sport league: ${unknown.join(', ')}`, 'SPORT_LEAGUE_NOT_FOUND');
    }
    const updated = await this.deps.leagues.update(leagueId, { mutedSportLeagueIds: muted });
    this.deps.logger?.info({
      action: 'league.updateEventEmailSettings.success',
      data: { leagueId, mutedCount: muted.length },
    }, 'Updated league event email settings');
    return updated;
  }
}

export function createLeagueEventEmailSettingsHandler(
  settings: LeagueEventEmailSettings,
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
