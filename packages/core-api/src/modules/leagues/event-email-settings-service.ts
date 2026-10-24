/**
 * Which sport leagues' upcoming events a league's commissioners are emailed about (#851): "Coming
 * up soon" (C1) and "Ready for contests" (C2). A league setting, set by its commissioners; a new
 * league hears about every sport league.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { LeagueRepository, SportLeagueRepository } from '@poolmaster/shared/db';
import type { League } from '@poolmaster/shared/domain';
import type { UpdateLeagueEventEmailSettingsRequest } from '@poolmaster/shared/dto';
import { LeagueNotFoundError, LeagueOperationError } from './service';

export interface LeagueEventEmailSettingsServiceDeps {
  leagues: Pick<LeagueRepository, 'findById' | 'update'>;
  sportLeagues: Pick<SportLeagueRepository, 'findAll'>;
  logger?: FastifyBaseLogger;
}

export class LeagueEventEmailSettingsService {
  constructor(private readonly deps: LeagueEventEmailSettingsServiceDeps) {}

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
