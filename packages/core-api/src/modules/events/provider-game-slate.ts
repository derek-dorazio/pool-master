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
import type { ProviderBracketMatch, ProviderScheduledGame } from '../ingestion/core/provider-interface';
import { reseededRounds, roundPlacementBlocker } from './bracket-reseed';
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
  bracket: Pick<SportEventBracketService, 'loadBracket' | 'updateMatch' | 'proposeRoundMatchups' | 'setRoundMatchups'>;
  logger?: FastifyBaseLogger;
}

type Sides = Pick<BracketMatchInput, 'homeSportEventParticipantId' | 'awaySportEventParticipantId'>;

/** What a provider gives for an event's games: its games so far, and for a fixed-shape playoff its whole bracket. */
export interface ProviderGameSlateInput {
  providerId: string;
  externalId: string;
  games: readonly ProviderScheduledGame[];
  bracket?: readonly ProviderBracketMatch[];
}

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
 *
 * A playoff whose shape is fixed (the NFL postseason) comes with its whole bracket: a draft loads
 * it, every match from the first round to the final, whenever its shape or teams differ from the
 * stored one; the games then keep its kickoffs current. Once released, a reseeded round whose
 * teams the provider's games name is placed by the server's own reseed (`proposeRoundMatchups`)
 * when the provider pairs the teams the same way; a different pairing is logged for an admin.
 *
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
  async afterFieldLoad(detail: { providerId: string; externalId: string; games?: readonly ProviderScheduledGame[]; bracket?: readonly ProviderBracketMatch[] }): Promise<ProviderGameSlateOutcome | null> {
    if (detail.games === undefined && detail.bracket === undefined) return null;
    try {
      const slate = await this.syncGames({ providerId: detail.providerId, externalId: detail.externalId, games: detail.games ?? [], bracket: detail.bracket });
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

  async syncGames(input: ProviderGameSlateInput): Promise<ProviderGameSlateOutcome> {
    const event = await this.deps.sportEvents.findByProviderRef(input.providerId, input.externalId);
    const skipped = skipReason(event);
    if (skipped !== null || event === null) {
      return { outcome: 'SKIPPED', reason: skipped ?? 'NO_EVENT' };
    }

    const fieldRowOf = await this.fieldRows(event, input);
    if (fieldRowOf === null) {
      return { outcome: 'SKIPPED', reason: 'TEAMS_NOT_IN_FIELD' };
    }
    const slate = slateOf(input.games, fieldRowOf);
    const stored = await this.deps.matches.findBySportEvent(event.id);
    const draft = event.status === SportEventStatus.DRAFT;
    if (draft) {
      const load = input.bracket === undefined ? slate : bracketOf(input.bracket, fieldRowOf);
      const same = input.bracket === undefined ? samePairings(stored, load) : sameBracket(stored, load);
      if (!same) {
        await this.deps.bracket.loadBracket(event.id, load);
        this.deps.logger?.info(
          { sportEventId: event.id, providerId: input.providerId, externalId: input.externalId, matchCount: load.length, replaced: stored.length },
          'Loaded a synced event\'s games from its provider',
        );
        return { outcome: 'LOADED', sportEventId: event.id, matchCount: load.length };
      }
      return this.updateMatches(event, draft, stored, slate, []);
    }
    const placed = await this.placeReseededRounds(event, stored, slate);
    const current = placed.length === 0 ? stored : await this.deps.matches.findBySportEvent(event.id);
    return this.updateMatches(event, draft, current, slate, placed);
  }

  /**
   * Each provider team's field row, by the provider's id for it; null when a team of the games or
   * the bracket is not in the event's field yet.
   */
  private async fieldRows(event: SportEvent, input: ProviderGameSlateInput): Promise<((teamExternalId: string) => string) | null> {
    const teamIds = [...new Set([
      ...input.games.flatMap((game) => [game.homeTeamExternalId, game.awayTeamExternalId]),
      ...(input.bracket ?? []).flatMap((match) => [match.homeTeamExternalId, match.awayTeamExternalId]).filter((team) => team !== null),
    ])];
    const [mappings, field] = await Promise.all([
      this.deps.mappings.findByProviderExternalIds(input.providerId, teamIds),
      this.deps.field.findBySportEvent(event.id),
    ]);
    const participantByTeam = new Map(mappings.map((mapping) => [mapping.externalId, mapping.participantId]));
    const fieldRowByParticipant = new Map(field.map((row) => [row.participantId, row.id]));
    const rowByTeam = new Map(teamIds.flatMap((teamId) => {
      const participantId = participantByTeam.get(teamId);
      const row = participantId === undefined ? undefined : fieldRowByParticipant.get(participantId);
      return row === undefined ? [] : [[teamId, row] as const];
    }));
    const missing = teamIds.filter((teamId) => !rowByTeam.has(teamId));
    if (missing.length > 0) {
      this.deps.logger?.warn(
        { sportEventId: event.id, providerId: input.providerId, missingTeams: missing },
        'Left a synced event\'s games unloaded: some teams are not in its field yet',
      );
      return null;
    }
    return (teamExternalId) => {
      const row = rowByTeam.get(teamExternalId);
      if (row === undefined) throw new Error(`Team ${teamExternalId} was not among the slate's teams.`);
      return row;
    };
  }

  /**
   * Places each reseeded round of a released bracket that is still open and whose every game the
   * provider lists with both teams, once the round before is played: the server's reseed proposes
   * the pairing, and it is set when the provider pairs the same teams. Returns the matches placed.
   */
  private async placeReseededRounds(event: SportEvent, stored: readonly SportEventMatch[], slate: readonly BracketMatchInput[]): Promise<number[]> {
    const placed: number[] = [];
    for (const roundNumber of [...reseededRounds(stored)].sort((left, right) => left - right)) {
      const round = stored.filter((match) => match.roundNumber === roundNumber);
      const games = slate.filter((game) => game.roundNumber === roundNumber);
      const open = round.some((match) => match.homeSportEventParticipantId === null || match.awaySportEventParticipantId === null);
      if (!open || games.length !== round.length || roundPlacementBlocker(stored, roundNumber) !== null) continue;
      // poolmaster-allow-query-in-loop: a playoff has a reseeded round or two, and one is placed at a time
      const proposal = await this.deps.bracket.proposeRoundMatchups(event.id, roundNumber);
      const providerPairs = new Set(games.map(pairKey));
      if (!proposal.every((matchup) => providerPairs.has(pairKey(matchup)))) {
        this.deps.logger?.warn(
          { sportEventId: event.id, roundNumber, providerPairings: [...providerPairs], proposedPairings: proposal.map(pairKey) },
          'Left a synced event\'s reseeded round unplaced: its provider pairs the teams differently from the reseed; an admin decides',
        );
        continue;
      }
      // poolmaster-allow-query-in-loop: as above
      await this.deps.bracket.setRoundMatchups(event.id, roundNumber, proposal);
      placed.push(...proposal.map((matchup) => matchup.matchNumber));
      this.deps.logger?.info({ sportEventId: event.id, roundNumber }, 'Placed a synced event\'s reseeded round from its provider\'s games');
    }
    return placed;
  }

  /**
   * Each stored match of a provider game's two teams takes the game's kickoff while it has not
   * started, and on a draft the game's home and away, its spread turned around with them.
   */
  private async updateMatches(
    event: SportEvent,
    draft: boolean,
    stored: readonly SportEventMatch[],
    slate: readonly BracketMatchInput[],
    placed: readonly number[],
  ): Promise<ProviderGameSlateOutcome> {
    const storedByPair = new Map(stored.map((match) => [pairKey(match), match]));
    const updated: number[] = [...placed];
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
      if (!updated.includes(match.matchNumber)) updated.push(match.matchNumber);
    }
    if (unmatched.length > 0 || swapped.length > 0) {
      this.deps.logger?.warn(
        { sportEventId: event.id, ...(unmatched.length > 0 && { unmatchedPairings: unmatched }), ...(swapped.length > 0 && { swappedMatchNumbers: swapped }) },
        'A released synced event\'s provider changed games its matches hold fixed; an admin decides',
      );
    }
    if (updated.length === 0) return { outcome: 'UNCHANGED', sportEventId: event.id };
    this.deps.logger?.info({ sportEventId: event.id, matchNumbers: updated }, 'Kept a synced event\'s matches current with its provider\'s games');
    return { outcome: 'MATCHES_UPDATED', sportEventId: event.id, matchNumbers: updated.sort((left, right) => left - right) };
  }
}

function skipReason(event: SportEvent | null): Extract<ProviderGameSlateOutcome, { outcome: 'SKIPPED' }>['reason'] | null {
  if (event === null) return 'NO_EVENT';
  if (!isProviderSyncedEvent(event)) return 'NOT_SYNCED';
  if (!eventPlaysMatches(event)) return 'PLAYS_NO_GAMES';
  if (event.status === SportEventStatus.COMPLETED || event.status === SportEventStatus.CANCELLED) return 'FINISHED';
  return null;
}

/** The provider's games as the event's matches, in round and kickoff order. */
function slateOf(games: readonly ProviderScheduledGame[], fieldRowOf: (teamExternalId: string) => string): BracketMatchInput[] {
  return [...games]
    .sort(byRoundThenKickoff)
    .map((game, index) => ({
      matchNumber: index + 1,
      roundNumber: game.roundNumber,
      homeSportEventParticipantId: fieldRowOf(game.homeTeamExternalId),
      awaySportEventParticipantId: fieldRowOf(game.awayTeamExternalId),
      isNeutralSite: game.isNeutralSite,
      scheduledDate: game.scheduledAt,
      advancesTo: null,
    }));
}

/** The provider's bracket as the event's, each named side its team's field row. */
function bracketOf(bracket: readonly ProviderBracketMatch[], fieldRowOf: (teamExternalId: string) => string): BracketMatchInput[] {
  return bracket.map((match) => ({
    matchNumber: match.matchNumber,
    roundNumber: match.roundNumber,
    homeSportEventParticipantId: match.homeTeamExternalId === null ? null : fieldRowOf(match.homeTeamExternalId),
    awaySportEventParticipantId: match.awayTeamExternalId === null ? null : fieldRowOf(match.awayTeamExternalId),
    isNeutralSite: match.isNeutralSite,
    scheduledDate: match.scheduledAt,
    advancesTo: match.advancesTo,
    regionLabel: match.regionLabel,
  }));
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

/** Whether the stored bracket has the provider's shape and teams, match by match, kickoffs aside. */
function sameBracket(stored: readonly SportEventMatch[], bracket: readonly BracketMatchInput[]): boolean {
  if (stored.length !== bracket.length) return false;
  const numberById = new Map(stored.map((match) => [match.id, match.matchNumber]));
  const storedByNumber = new Map(stored.map((match) => [match.matchNumber, match]));
  return bracket.every((slot) => {
    const match = storedByNumber.get(slot.matchNumber);
    if (match === undefined) return false;
    const advancesTo = match.advancesToMatchId === null ? null : `${String(numberById.get(match.advancesToMatchId))}/${String(match.advancesToSide)}`;
    return match.roundNumber === slot.roundNumber
      && match.homeSportEventParticipantId === slot.homeSportEventParticipantId
      && match.awaySportEventParticipantId === slot.awaySportEventParticipantId
      && match.isNeutralSite === slot.isNeutralSite
      && match.regionLabel === (slot.regionLabel ?? null)
      && advancesTo === (slot.advancesTo === null ? null : `${String(slot.advancesTo.matchNumber)}/${slot.advancesTo.side}`);
  });
}

/** Whether the stored matches pair the same teams as the provider's games, kickoffs and sides aside. */
function samePairings(stored: readonly SportEventMatch[], slate: readonly BracketMatchInput[]): boolean {
  if (stored.length !== slate.length) return false;
  const storedPairs = new Set(stored.map(pairKey));
  return slate.every((match) => storedPairs.has(pairKey(match)));
}
