/**
 * The box score writer (#2026, plans/league-model-redesign.md §5): the one writer of a Game's
 * player stat rows (`SportEventRoundMatchGamePlayerStat`). It takes a league's box score lines for
 * some of its Games and keeps each Game's rows to what the feed last sent.
 *
 * Each line is placed on a side of its Game's Match, the same way in every sport:
 * - the player's own side, where the player is a side of the Match (a golfer, a driver);
 * - otherwise the side of their team, the team of their roster row in the Game's Season.
 * A player who plays neither (their team is not in the Game, or they have no roster row in the
 * Season) is refused, raising one BOX_SCORE_PLAYER_NOT_IN_GAME warning; a feed id no player of the
 * league is mapped from raises UNMAPPED_PARTICIPANT, as the roster sync's does. The rest of the box
 * score is written. A Game the feed sent no line for keeps its rows: an empty answer is not a
 * correction.
 *
 * It reads in a fixed few queries however many Games and players there are, and writes only the
 * Games whose rows changed, in one transaction.
 */

import type { GamePlayerStatRepository, GamePlayerStatRow, StatGame, StatPlayer } from '@poolmaster/shared/db';
import { ProviderSyncFindingKind, ProviderSyncFindingSeverity, type ProviderCode, type ProviderSyncFindingRaise } from '@poolmaster/shared/domain';
import type { ProviderPlayerGameStats } from '../core/provider-interface';
import type { ProviderSyncFindingService, UnmappedFeedParticipant } from '../findings/provider-sync-finding-service';

export interface GamePlayerStatWriterOptions {
  stats: GamePlayerStatRepository;
  findings: Pick<ProviderSyncFindingService, 'raiseOfSource' | 'raiseUnmappedParticipants'>;
}

/** What one write did. */
export interface GamePlayerStatWriteCounts {
  /** Games the feed sent a line for. */
  gamesRead: number;
  /** Games whose rows were rewritten, since what the feed sent differs from what was kept. */
  gamesChanged: number;
  /** Stat rows the changed Games now hold. */
  rowsWritten: number;
  /** Players refused, once per event: they play no side of their Game. */
  playersNotInGame: number;
  /** Feed ids no player of the league is mapped from. */
  playersUnmapped: number;
}

/** A line placed on its Game's side, or why it was not. */
type PlacedStatLine =
  | { placed: true; rows: GamePlayerStatRow[] }
  | { placed: false; reason: typeof StatLineRefusal[keyof typeof StatLineRefusal] };

/** Why a line is not written. */
const StatLineRefusal = {
  /** No player of the league is mapped from the line's feed id. */
  UNMAPPED: 'UNMAPPED',
  /** The player is not a side of the Game, nor is their Season roster row's team. */
  NOT_IN_GAME: 'NOT_IN_GAME',
} as const;

/**
 * One line's stat rows, on the side the player played: their own side, else their roster team's.
 * The one rule that places a stat, for every sport.
 */
function placeStatLine(game: StatGame, player: StatPlayer | undefined, line: ProviderPlayerGameStats): PlacedStatLine {
  if (player === undefined) return { placed: false, reason: StatLineRefusal.UNMAPPED };
  const side = game.sides.find((each) => each.participantId === player.participantId)
    ?? (player.teamParticipantId === null ? undefined : game.sides.find((each) => each.participantId === player.teamParticipantId));
  if (side === undefined) return { placed: false, reason: StatLineRefusal.NOT_IN_GAME };
  // A feed naming one stat twice in a line is taken at its last word.
  const values = new Map(line.stats.map((each) => [each.stat, each.value]));
  return {
    placed: true,
    rows: [...values].map(([stat, value]) => ({
      sportEventRoundMatchId: game.sportEventRoundMatchId,
      sportEventRoundMatchGameId: game.sportEventRoundMatchGameId,
      sportEventRoundMatchSideId: side.sportEventRoundMatchSideId,
      participantId: player.participantId,
      stat,
      value,
    })),
  };
}

function rowKey(row: GamePlayerStatRow): string {
  return [row.sportEventRoundMatchGameId, row.participantId, row.stat].join('|');
}

function sameRows(left: readonly GamePlayerStatRow[], right: readonly GamePlayerStatRow[]): boolean {
  if (left.length !== right.length) return false;
  const byKey = new Map(left.map((row) => [rowKey(row), row]));
  return right.every((row) => {
    const kept = byKey.get(rowKey(row));
    return kept !== undefined && kept.value === row.value && kept.sportEventRoundMatchSideId === row.sportEventRoundMatchSideId;
  });
}

export class GamePlayerStatWriter {
  constructor(private readonly options: GamePlayerStatWriterOptions) {}

  /**
   * Writes the lines onto the Games they name. A line naming a game not among `games` is no line
   * of this write and is ignored.
   */
  async write(input: {
    sportLeagueId: string;
    providerCode: ProviderCode;
    /** The feed's provider id, as its findings are raised against it. */
    providerSourceId: string;
    games: readonly StatGame[];
    lines: readonly ProviderPlayerGameStats[];
  }): Promise<GamePlayerStatWriteCounts> {
    const gameByProviderId = new Map(input.games.flatMap((game) => (game.providerGameId === null ? [] : [[game.providerGameId, game] as const])));
    const lines = input.lines.filter((line) => gameByProviderId.has(line.providerGameId));

    // One read of the players for each Season the Games are in: one Season in practice.
    const players = new Map<string, Map<string, StatPlayer>>();
    for (const season of new Set(lines.map((line) => gameByProviderId.get(line.providerGameId)?.sportLeagueSeasonId))) {
      if (season === undefined) continue;
      // poolmaster-allow-query-in-loop: one read per Season the Games are in, one in practice (a slot's Games are one Season's)
      players.set(season, await this.options.stats.findStatPlayers({
        sportLeagueId: input.sportLeagueId,
        sportLeagueSeasonId: season,
        providerCode: input.providerCode,
        playerExternalIds: lines.filter((line) => gameByProviderId.get(line.providerGameId)?.sportLeagueSeasonId === season).map((line) => line.playerExternalId),
      }));
    }

    const rowsByGame = new Map<string, Map<string, GamePlayerStatRow>>();
    const unmapped = new Map<string, UnmappedFeedParticipant>();
    const notInGame = new Map<string, Omit<ProviderSyncFindingRaise, 'providerId'>>();
    for (const line of lines) {
      const game = gameByProviderId.get(line.providerGameId);
      if (game === undefined) continue;
      const placed = placeStatLine(game, players.get(game.sportLeagueSeasonId)?.get(line.playerExternalId), line);
      if (!placed.placed) {
        if (placed.reason === StatLineRefusal.UNMAPPED) unmapped.set(line.playerExternalId, { externalId: line.playerExternalId, name: line.playerName });
        else notInGame.set(`${game.sportEventId}|${line.playerExternalId}`, notInGameFinding(input.sportLeagueId, game, line));
        continue;
      }
      const rows = rowsByGame.get(game.sportEventRoundMatchGameId) ?? new Map<string, GamePlayerStatRow>();
      for (const row of placed.rows) rows.set(rowKey(row), row);
      rowsByGame.set(game.sportEventRoundMatchGameId, rows);
    }

    const readGameIds = [...rowsByGame.keys()];
    const kept = await this.options.stats.findGameStats(readGameIds);
    const changed = readGameIds.filter((gameId) => !sameRows(
      kept.filter((row) => row.sportEventRoundMatchGameId === gameId),
      [...(rowsByGame.get(gameId)?.values() ?? [])],
    ));
    const rows = changed.flatMap((gameId) => [...(rowsByGame.get(gameId)?.values() ?? [])]);
    await this.options.stats.replaceGameStats({ sportLeagueId: input.sportLeagueId, sportEventRoundMatchGameIds: changed, rows });

    await this.options.findings.raiseUnmappedParticipants({ sportLeagueId: input.sportLeagueId, providerSourceId: input.providerSourceId, participants: [...unmapped.values()] });
    await this.options.findings.raiseOfSource(input.providerSourceId, [...notInGame.values()]);
    return {
      gamesRead: new Set(lines.map((line) => line.providerGameId)).size,
      gamesChanged: changed.length,
      rowsWritten: rows.length,
      playersNotInGame: notInGame.size,
      playersUnmapped: unmapped.size,
    };
  }
}

function notInGameFinding(sportLeagueId: string, game: StatGame, line: ProviderPlayerGameStats): Omit<ProviderSyncFindingRaise, 'providerId'> {
  return {
    kind: ProviderSyncFindingKind.BOX_SCORE_PLAYER_NOT_IN_GAME,
    severity: ProviderSyncFindingSeverity.WARNING,
    sportLeagueId,
    sportEventId: game.sportEventId,
    providerValue: line.playerExternalId,
    providerValueName: line.playerName,
  };
}
