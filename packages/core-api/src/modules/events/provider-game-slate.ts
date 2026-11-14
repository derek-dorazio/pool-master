import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantProviderMappingRepository,
  SportEventMatchRepository,
  SportEventParticipantRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  eventPlaysMatches,
  isProviderSyncedEvent,
  MatchStatus,
  SportEventStatus,
  type SportEvent,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import type { ProviderScheduledGame } from '../ingestion/core/provider-interface';
import type { BracketMatchInput, SportEventBracketService } from './sport-event-bracket-service';

/** What one slate sync did to the event's games, and why when it did nothing. */
export type ProviderGameSlateOutcome =
  | { outcome: 'LOADED'; sportEventId: string; matchCount: number }
  | { outcome: 'MATCHES_UPDATED'; sportEventId: string; matchNumbers: number[] }
  | { outcome: 'UNCHANGED'; sportEventId: string }
  | { outcome: 'SKIPPED'; reason: 'NO_EVENT' | 'NOT_SYNCED' | 'PLAYS_NO_GAMES' | 'FINISHED' | 'TEAMS_NOT_IN_FIELD' };

export interface ProviderGameSlateDeps {
  sportEvents: Pick<SportEventRepository, 'findByProviderRef'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent'>;
  field: Pick<SportEventParticipantRepository, 'findBySportEvent'>;
  mappings: Pick<ParticipantProviderMappingRepository, 'findByProviderExternalIds'>;
  bracket: Pick<SportEventBracketService, 'loadBracket' | 'updateMatch'>;
  logger?: FastifyBaseLogger;
}

type Sides = Pick<BracketMatchInput, 'homeSportEventParticipantId' | 'awaySportEventParticipantId'>;

/**
 * A synced sport league's event takes its games from its provider (ADR 0011, #1728): a game
 * week's games (an NFL week, a Premier League matchweek) become the event's matches, as an admin
 * would load them through `loadBracket`. Each provider game is matched to a stored match by its
 * two teams, whichever side each is on. While the event is a draft and the provider's pairings
 * differ from the stored ones, the slate replaces them: the provider wins, and nobody can have
 * picked yet. Otherwise each match is kept, with its spread, and takes the provider's kickoff if
 * it has not started; on a draft it also takes the provider's home and away, its spread turned
 * around. Once the event is released its pairings and sides are fixed: a pairing or a swap the
 * provider makes after release is logged for an admin.
 * A finished or cancelled event, an event whose league is not synced to this provider, and one
 * whose teams are not all in its field yet (the field load comes first) are left alone.
 */
export class ProviderGameSlateService {
  constructor(private readonly deps: ProviderGameSlateDeps) {}

  /**
   * After a field load: syncs the detail's games when the provider listed any. The field is
   * written either way, so a refused slate is logged, not thrown, and the next field load tries
   * again. Null when the provider listed no games.
   */
  async afterFieldLoad(detail: { providerId: string; externalId: string; games?: readonly ProviderScheduledGame[] }): Promise<ProviderGameSlateOutcome | null> {
    if (detail.games === undefined) return null;
    try {
      const slate = await this.syncGames({ providerId: detail.providerId, externalId: detail.externalId, games: detail.games });
      this.deps.logger?.info({ providerId: detail.providerId, externalId: detail.externalId, slate }, 'Synced event games from provider');
      return slate;
    } catch (error) {
      this.deps.logger?.error(
        { providerId: detail.providerId, externalId: detail.externalId, error: error instanceof Error ? error.message : String(error) },
        'Could not sync event games from provider',
      );
      return null;
    }
  }

  async syncGames(input: { providerId: string; externalId: string; games: readonly ProviderScheduledGame[] }): Promise<ProviderGameSlateOutcome> {
    const event = await this.deps.sportEvents.findByProviderRef(input.providerId, input.externalId);
    const skipped = skipReason(event);
    if (skipped !== null || event === null) {
      return { outcome: 'SKIPPED', reason: skipped ?? 'NO_EVENT' };
    }

    const slate = await this.slateOf(event, input.providerId, input.games);
    if (slate === null) {
      return { outcome: 'SKIPPED', reason: 'TEAMS_NOT_IN_FIELD' };
    }
    const stored = await this.deps.matches.findBySportEvent(event.id);
    const draft = event.status === SportEventStatus.DRAFT;
    if (draft && !samePairings(stored, slate)) {
      await this.deps.bracket.loadBracket(event.id, slate);
      this.deps.logger?.info(
        { sportEventId: event.id, providerId: input.providerId, externalId: input.externalId, matchCount: slate.length, replaced: stored.length },
        'Loaded a synced event\'s games from its provider',
      );
      return { outcome: 'LOADED', sportEventId: event.id, matchCount: slate.length };
    }
    return this.updateMatches(event, draft, stored, slate);
  }

  /** The provider's games as the event's matches, in kickoff order; null when a team is not in the field. */
  private async slateOf(event: SportEvent, providerId: string, games: readonly ProviderScheduledGame[]): Promise<BracketMatchInput[] | null> {
    const teamIds = [...new Set(games.flatMap((game) => [game.homeTeamExternalId, game.awayTeamExternalId]))];
    const [mappings, field] = await Promise.all([
      this.deps.mappings.findByProviderExternalIds(providerId, teamIds),
      this.deps.field.findBySportEvent(event.id),
    ]);
    const participantByTeam = new Map(mappings.map((mapping) => [mapping.externalId, mapping.participantId]));
    const fieldRowByParticipant = new Map(field.map((row) => [row.participantId, row.id]));
    const fieldRowOf = (teamExternalId: string): string | undefined => {
      const participantId = participantByTeam.get(teamExternalId);
      return participantId === undefined ? undefined : fieldRowByParticipant.get(participantId);
    };
    const missing = teamIds.filter((teamId) => fieldRowOf(teamId) === undefined);
    if (missing.length > 0) {
      this.deps.logger?.warn(
        { sportEventId: event.id, providerId, missingTeams: missing },
        'Left a synced event\'s games unloaded: some teams are not in its field yet',
      );
      return null;
    }
    return [...games]
      .sort(byRoundThenKickoff)
      .map((game, index) => ({
        matchNumber: index + 1,
        roundNumber: game.roundNumber,
        homeSportEventParticipantId: fieldRowOf(game.homeTeamExternalId) ?? null,
        awaySportEventParticipantId: fieldRowOf(game.awayTeamExternalId) ?? null,
        isNeutralSite: game.isNeutralSite,
        scheduledDate: game.scheduledAt,
        advancesTo: null,
      }));
  }

  /**
   * Each stored match of a provider game's two teams takes the game's kickoff while it has not
   * started, and on a draft the game's home and away, its spread turned around with them.
   */
  private async updateMatches(event: SportEvent, draft: boolean, stored: readonly SportEventMatch[], slate: readonly BracketMatchInput[]): Promise<ProviderGameSlateOutcome> {
    const storedByPair = new Map(stored.map((match) => [pairKey(match), match]));
    const updated: number[] = [];
    const swapped: number[] = [];
    const unmatched: string[] = [];
    for (const game of slate) {
      const match = storedByPair.get(pairKey(game));
      if (match === undefined) {
        unmatched.push(pairKey(game));
        continue;
      }
      const isSwapped = match.homeSportEventParticipantId !== game.homeSportEventParticipantId;
      const movesKickoff = match.status === MatchStatus.SCHEDULED && game.scheduledDate !== null && !sameTime(match.scheduledDate, game.scheduledDate);
      if (isSwapped && !draft) swapped.push(match.matchNumber);
      const patch = {
        ...(movesKickoff && { scheduledDate: game.scheduledDate }),
        ...(isSwapped && draft && {
          homeSportEventParticipantId: game.homeSportEventParticipantId,
          awaySportEventParticipantId: game.awaySportEventParticipantId,
          ...(match.homeSpread !== null && { homeSpread: -match.homeSpread }),
        }),
      };
      if (Object.keys(patch).length === 0) continue;
      await this.deps.bracket.updateMatch(event.id, match.matchNumber, patch);
      updated.push(match.matchNumber);
    }
    if (unmatched.length > 0 || swapped.length > 0) {
      this.deps.logger?.warn(
        { sportEventId: event.id, ...(unmatched.length > 0 && { unmatchedPairings: unmatched }), ...(swapped.length > 0 && { swappedMatchNumbers: swapped }) },
        'A released synced event\'s provider changed games its matches hold fixed; an admin decides',
      );
    }
    if (updated.length === 0) return { outcome: 'UNCHANGED', sportEventId: event.id };
    this.deps.logger?.info({ sportEventId: event.id, matchNumbers: updated }, 'Kept a synced event\'s matches current with its provider\'s games');
    return { outcome: 'MATCHES_UPDATED', sportEventId: event.id, matchNumbers: updated };
  }
}

function skipReason(event: SportEvent | null): Extract<ProviderGameSlateOutcome, { outcome: 'SKIPPED' }>['reason'] | null {
  if (event === null) return 'NO_EVENT';
  if (!isProviderSyncedEvent(event)) return 'NOT_SYNCED';
  if (!eventPlaysMatches(event)) return 'PLAYS_NO_GAMES';
  if (event.status === SportEventStatus.COMPLETED || event.status === SportEventStatus.CANCELLED) return 'FINISHED';
  return null;
}

function byRoundThenKickoff(left: ProviderScheduledGame, right: ProviderScheduledGame): number {
  return left.roundNumber - right.roundNumber
    || (left.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
    || left.externalGameId.localeCompare(right.externalGameId);
}

/** A match's two teams, whichever side each is on. */
function pairKey(match: Sides): string {
  return [match.homeSportEventParticipantId ?? '-', match.awaySportEventParticipantId ?? '-'].sort().join('|');
}

function sameTime(left: Date | null, right: Date | null): boolean {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

/** Whether the stored matches pair the same teams as the provider's games, kickoffs and sides aside. */
function samePairings(stored: readonly SportEventMatch[], slate: readonly BracketMatchInput[]): boolean {
  if (stored.length !== slate.length) return false;
  const storedPairs = new Set(stored.map(pairKey));
  return slate.every((match) => storedPairs.has(pairKey(match)));
}
