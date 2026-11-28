/**
 * The BALLDONTLIE box score read (#2026): one league's players' stats in the games asked for, from
 * its per-game player stats endpoint (`box-score-contract.ts`), each row a player's line in one
 * game with the stats the vendor sent. A row naming no game or player is a contract fault, since
 * the line cannot be placed.
 */

import type { SportStat } from '@poolmaster/shared/domain';
import type { ProviderPlayerGameStats } from '../../core/provider-interface';
import { BALLDONTLIE_MAX_PER_PAGE, BalldontlieContractError, type BalldontlieClient } from './balldontlie-client';
import type { BoxScoreEndpoint } from './box-score-contract';
import { participantFeedId } from './participant-feed-id';

/** A vendor game id: a positive whole number. Anything else names no game of the vendor's. */
const GAME_ID_PATTERN = /^[1-9]\d{0,9}$/;

export class BoxScoreReader {
  constructor(
    private readonly client: BalldontlieClient,
    private readonly endpoint: BoxScoreEndpoint,
  ) {}

  /**
   * Every player's line in the games, read a page of games at a time. An id that is no vendor game
   * id is refused before anything is read, as the vendor would refuse it.
   */
  async boxScores(providerGameIds: readonly string[]): Promise<ProviderPlayerGameStats[]> {
    const malformed = providerGameIds.filter((id) => !GAME_ID_PATTERN.test(id));
    if (malformed.length > 0) throw new BalldontlieContractError(this.endpoint.path, malformed.map((id) => `"${id}" is not a game id`));
    const lines: ProviderPlayerGameStats[] = [];
    const ids = [...new Set(providerGameIds)].map(Number);
    for (let start = 0; start < ids.length; start += BALLDONTLIE_MAX_PER_PAGE) {
      const rows = await this.client.getAllPages(this.endpoint.path, { [this.endpoint.gameIdsParam]: ids.slice(start, start + BALLDONTLIE_MAX_PER_PAGE) }, this.endpoint.schema);
      lines.push(...rows.map((row) => this.toLine(row)));
    }
    return lines;
  }

  private toLine(row: Record<string, unknown>): ProviderPlayerGameStats {
    const { gameId, playerId, playerName } = this.endpoint.ids(row);
    if (gameId === undefined || playerId === undefined) {
      throw new BalldontlieContractError(this.endpoint.path, [`a box score row names no ${gameId === undefined ? 'game' : 'player'}`]);
    }
    const stats = (Object.entries(this.endpoint.columns) as Array<[SportStat, string]>).flatMap(([stat, column]) => {
      const value = row[column];
      return typeof value === 'number' ? [{ stat, value }] : [];
    });
    return { providerGameId: String(gameId), playerExternalId: participantFeedId(playerId), playerName, stats };
  }
}
