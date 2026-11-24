/**
 * The daily current-Season recompute (#2003, plan §2): every sport league's `currentSeasonId` is
 * chosen again from its Season rows by the one rule, `currentSeasonOf`, and written where it
 * moved. Nothing else sets it, and nothing works out a current season from today's date, so every
 * reader of "the current season" (the events sync, the root admin's pickers, event create) agrees.
 * The nightly scheduler runs it once a day.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { SportLeagueSeasonRepository } from '@poolmaster/shared/db';
import { currentSeasonOf } from '@poolmaster/shared/domain';
import type { NightlyCleanupStep } from '../../core/nightly-cleanup';

export class CurrentSeasonRecompute implements NightlyCleanupStep {
  readonly name = 'currentSeasons';

  constructor(
    private readonly seasons: Pick<SportLeagueSeasonRepository, 'findCurrentSeasonFacts' | 'setCurrentSeasons'>,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /** Resolves to how many leagues' current Season moved. */
  async purge(now: Date): Promise<number> {
    const facts = await this.seasons.findCurrentSeasonFacts();
    const changes = facts.flatMap((league) => {
      const currentSeasonId = currentSeasonOf(league.seasons, now);
      return currentSeasonId === league.currentSeasonId ? [] : [{ sportLeagueId: league.sportLeagueId, currentSeasonId, previousSeasonId: league.currentSeasonId }];
    });
    await this.seasons.setCurrentSeasons(changes.map(({ sportLeagueId, currentSeasonId }) => ({ sportLeagueId, currentSeasonId })));
    for (const change of changes) {
      this.logger?.info({ action: 'sportLeague.currentSeason.moved', data: change }, 'A sport league\'s current Season moved');
    }
    return changes.length;
  }
}
