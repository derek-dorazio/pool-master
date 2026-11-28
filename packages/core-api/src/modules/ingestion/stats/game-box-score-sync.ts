/**
 * A league's box score read for some of its Games (#2026, plans/league-model-redesign.md §5): the
 * Games' provider ids at the league's selected provider, that provider's box scores for them, and
 * the box score writer.
 *
 * A league whose box scores are read must be on a provider plan with player stats. When its
 * Provider row says the plan has none (`hasPlayerStats` off), nothing is read; when the provider
 * refuses the league's stats reads anyway, nothing is written. Either raises one
 * PROVIDER_PLAN_HAS_NO_STATS error for the league, which the next read that succeeds resolves.
 *
 * Which Games are read, and when, is the caller's: the box score fetch that reads only the slots a
 * Clutch Card covers or a rating window needs comes with the Clutch Card template's predicate.
 */

import type { GamePlayerStatRepository, SportLeagueRepository } from '@poolmaster/shared/db';
import { ProviderSyncFindingKind, ProviderSyncFindingSeverity, type ProviderSettings } from '@poolmaster/shared/domain';
import { ProviderSeasonScheduleError, type ProviderSeasonScheduleReader } from '../../events/provider-season-schedule-reader';
import type { ProviderPlayerGameStats } from '../core/provider-interface';
import type { ProviderSyncFindingService } from '../findings/provider-sync-finding-service';
import { providerByCode } from '../provider-settings-store';
import { GamePlayerStatWriter, type GamePlayerStatWriteCounts } from './game-player-stat-writer';

export interface GameBoxScoreSyncOptions {
  sportLeagues: Pick<SportLeagueRepository, 'findById'>;
  /** The Provider rows, in memory (ProviderSettingsStore): whose plan has player stats. */
  providers: { all(): readonly ProviderSettings[] };
  boxScoreSource: Pick<ProviderSeasonScheduleReader, 'listBoxScores'>;
  stats: GamePlayerStatRepository;
  findings: Pick<ProviderSyncFindingService, 'raiseOfSource' | 'raiseUnmappedParticipants' | 'resolveOfSource'>;
}

/** What a box score read did: nothing, for a plan without stats, or the writer's counts. */
export type GameBoxScoreSyncResult =
  | { planHasStats: false }
  | ({ planHasStats: true } & GamePlayerStatWriteCounts);

class GameBoxScoreSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameBoxScoreSyncError';
  }
}

// poolmaster-allow-test-export: its caller, the gated box score fetch job, is #2026 part B, which waits on the Clutch Card template's predicate (#2025 part C, #2192)
export class GameBoxScoreSync {
  private readonly writer: GamePlayerStatWriter;

  constructor(private readonly options: GameBoxScoreSyncOptions) {
    this.writer = new GamePlayerStatWriter({ stats: options.stats, findings: options.findings });
  }

  /** Reads and writes the box scores of these Games of the league; a Game its provider has no id for is not read. */
  async syncGames(sportLeagueId: string, sportEventRoundMatchGameIds: readonly string[]): Promise<GameBoxScoreSyncResult> {
    const sportLeague = await this.options.sportLeagues.findById(sportLeagueId);
    if (!sportLeague) throw new GameBoxScoreSyncError(`Sport league ${sportLeagueId} was not found.`);
    const mapping = sportLeague.selectedProviderMapping;
    if (mapping === null) throw new GameBoxScoreSyncError(`No provider syncs ${sportLeague.name}, so it has no box scores.`);

    const provider = providerByCode(this.options.providers.all(), mapping.providerCode);
    if (provider?.hasPlayerStats !== true) {
      await this.raisePlanHasNoStats(mapping.providerId, sportLeagueId);
      return { planHasStats: false };
    }

    const games = await this.options.stats.findStatGames({ sportLeagueId, providerCode: mapping.providerCode, sportEventRoundMatchGameIds });
    const providerGameIds = games.flatMap((game) => (game.providerGameId === null ? [] : [game.providerGameId]));
    let lines: ProviderPlayerGameStats[];
    try {
      lines = await this.options.boxScoreSource.listBoxScores(sportLeagueId, providerGameIds);
    } catch (error) {
      if (error instanceof ProviderSeasonScheduleError && error.code === 'PROVIDER_LEAGUE_REFUSED') {
        await this.raisePlanHasNoStats(mapping.providerId, sportLeagueId);
        return { planHasStats: false };
      }
      throw error;
    }
    await this.options.findings.resolveOfSource(mapping.providerId, { kind: ProviderSyncFindingKind.PROVIDER_PLAN_HAS_NO_STATS, sportLeagueId });
    const counts = await this.writer.write({ sportLeagueId, providerCode: mapping.providerCode, providerSourceId: mapping.providerId, games, lines });
    return { planHasStats: true, ...counts };
  }

  private raisePlanHasNoStats(providerSourceId: string, sportLeagueId: string): Promise<void> {
    return this.options.findings.raiseOfSource(providerSourceId, [{
      kind: ProviderSyncFindingKind.PROVIDER_PLAN_HAS_NO_STATS,
      severity: ProviderSyncFindingSeverity.ERROR,
      sportLeagueId,
      sportEventId: null,
      providerValue: null,
      providerValueName: null,
    }]);
  }
}
