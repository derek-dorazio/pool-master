import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'node:crypto';
import type {
  ParticipantProviderMappingRepository,
  SportEventRoundMatchGameCreate,
  SportEventRoundMatchGameRepository,
  SportEventRoundMatchRepository,
  SportEventParticipantRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  compareMatchPlaces,
  eventPlaysMatches,
  isAtPlace,
  isProviderSyncedEvent,
  isMatchUnplayed,
  gameNumbered,
  HomeAway,
  homeAwayOf,
  MatchSide,
  sideNumberOfMatchSide,
  sideParticipantId,
  type MatchPlace,
  MatchPlaceMap,
  matchPlaceOf,
  SportEventStatus,
  type SportEvent,
  type SportEventRoundMatch,
  isSportEventStatusFinished,
  requireProviderCodeOfSourceId,
  matchIsNeutralSite,
} from '@poolmaster/shared/domain';
import type { ProviderBracketMatch, ProviderScheduledGame } from '../ingestion/core/provider-interface';
import { reseededRounds, roundPlacementBlocker } from './bracket-reseed';
import type { BracketMatchInput, BracketSideInput, SportEventBracketService } from './sport-event-bracket-service';
import type { SportEventRoundService } from './sport-event-round-service';

/** What one slate sync did to the event's games, and why when it did nothing. */
export type ProviderGameSlateOutcome =
  | { outcome: 'LOADED'; sportEventId: string; matchCount: number }
  | { outcome: 'MATCHES_UPDATED'; sportEventId: string; matches: MatchPlace[] }
  | { outcome: 'UNCHANGED'; sportEventId: string }
  | { outcome: 'SKIPPED'; reason: 'NO_EVENT' | 'NOT_SYNCED' | 'PLAYS_NO_GAMES' | 'FINISHED' | 'TEAMS_NOT_IN_FIELD' };

export interface ProviderGameSlateDeps {
  sportEvents: Pick<SportEventRepository, 'findById'>;
  matches: Pick<SportEventRoundMatchRepository, 'findBySportEvent'>;
  games: Pick<SportEventRoundMatchGameRepository, 'findBySportEvent' | 'findByProviderExternalIds' | 'applySync'>;
  field: Pick<SportEventParticipantRepository, 'findBySportEvent'>;
  mappings: Pick<ParticipantProviderMappingRepository, 'findByProviderExternalIds'>;
  bracket: Pick<SportEventBracketService, 'loadBracket' | 'updateMatch' | 'proposeRoundMatchups' | 'setRoundMatchups'>;
  rounds: Pick<SportEventRoundService, 'listRounds' | 'reschedule'>;
  logger?: FastifyBaseLogger;
}

/**
 * A provider game's home and away teams as a match's sides: the sync puts the away team on side 1
 * and the home team on side 2, each playing Game 1 where the provider says, or NONE when its slot is
 * played at a neutral site (#2154).
 */
function sidesOfProviderGame(home: string | null, away: string | null, isNeutralSite: boolean): BracketSideInput[] {
  return [
    { sideNumber: sideNumberOfMatchSide(MatchSide.AWAY), sportEventParticipantId: away, homeAway: isNeutralSite ? HomeAway.NONE : HomeAway.AWAY },
    { sideNumber: sideNumberOfMatchSide(MatchSide.HOME), sportEventParticipantId: home, homeAway: isNeutralSite ? HomeAway.NONE : HomeAway.HOME },
  ].sort((left, right) => left.sideNumber - right.sideNumber);
}

/** What a provider gives for an event's games: its games so far, and for a fixed-shape playoff its whole bracket. */
export interface ProviderGameSlateInput {
  /**
   * The event whose field the provider just synced: one of the events its provider event's games
   * reach, one per competition (#2154).
   */
  sportEventId: string;
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
 * picked yet. Otherwise each match is kept, with its sides and spread, and takes the provider's
 * kickoff if it has not started. A match the sync creates puts the provider's away team on side 1
 * and its home team on side 2 (#2046); a game the provider later lists the other way round changes
 * only where each side plays Game 1 (`homeAway`), never the sides. Once the event is released its
 * pairings are fixed: a pairing the provider changes after release is logged for an admin.
 *
 * A playoff whose shape is fixed (the NFL postseason) comes with its whole bracket: a draft loads
 * it, every match from the first round to the final, whenever its shape or teams differ from the
 * stored one; the games then keep its kickoffs current. Once released, a reseeded round whose
 * teams the provider's games name is placed by the server's own reseed (`proposeRoundMatchups`)
 * when the provider pairs the teams the same way; a different pairing is logged for an admin.
 *
 * After a sync that loaded or changed matches, each round whose matches have a kickoff starts at
 * the earliest of them; a round with none yet keeps its date.
 *
 * Then each provider game is mapped to its Game (#2007): the Game of its number in the match of
 * its two teams, created for a series game the match has no Game for yet. A provider webhook about
 * the game routes to that Game from then on. Only an id no Game holds is mapped here: a Game that
 * holds another id, or an id another event's Game holds, is a re-issued or a moved game, which the
 * score sync settles with a finding.
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
  async afterFieldLoad(detail: { sportEventId: string; providerId: string; externalId: string; games?: readonly ProviderScheduledGame[]; bracket?: readonly ProviderBracketMatch[] }): Promise<ProviderGameSlateOutcome | null> {
    if (detail.games === undefined && detail.bracket === undefined) return null;
    try {
      const slate = await this.syncGames({ sportEventId: detail.sportEventId, providerId: detail.providerId, externalId: detail.externalId, games: detail.games ?? [], bracket: detail.bracket });
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
    const event = await this.deps.sportEvents.findById(input.sportEventId);
    const skipped = skipReason(event);
    if (skipped !== null || event === null) {
      return { outcome: 'SKIPPED', reason: skipped ?? 'NO_EVENT' };
    }

    // Only a draft loads the bracket, so a released event reads none: a side it names may have left
    // the field since, and must not hold up the games.
    const sync = event.status === SportEventStatus.DRAFT ? input : { ...input, bracket: undefined };
    const [fieldRowOf, neutralRounds] = await Promise.all([this.fieldRows(event, sync), this.neutralSiteRounds(event.id)]);
    if (fieldRowOf === null) {
      return { outcome: 'SKIPPED', reason: 'TEAMS_NOT_IN_FIELD' };
    }
    const outcome = await this.syncMatches(event, sync, fieldRowOf, neutralRounds);
    if (outcome.outcome !== 'UNCHANGED') await this.dateRoundsByKickoff(event.id);
    await this.mapProviderGames(event, input, fieldRowOf);
    return outcome;
  }

  /** Maps each provider game no Game holds to the Game of its number in its teams' match. */
  private async mapProviderGames(event: SportEvent, input: ProviderGameSlateInput, fieldRowOf: (teamExternalId: string) => string): Promise<void> {
    const providerGameIds = input.games.flatMap((game) => game.games.map((each) => each.providerGameId));
    if (providerGameIds.length === 0) return;
    const providerCode = requireProviderCodeOfSourceId(input.providerId);
    const [matches, stored, held] = await Promise.all([
      this.deps.matches.findBySportEvent(event.id),
      this.deps.games.findBySportEvent(event.id, providerCode),
      this.deps.games.findByProviderExternalIds(providerCode, providerGameIds),
    ]);
    const heldIds = new Set(held.flatMap((each) => (each.externalId === null ? [] : [each.externalId])));
    const matchByPair = new Map(matches.map((match) => [pairKey(match), match]));
    const gameAt = new Map(stored.map((each) => [JSON.stringify([each.game.sportEventRoundMatchId, each.game.gameNumber]), each]));
    const created: SportEventRoundMatchGameCreate[] = [];
    const mapped: { sportEventRoundMatchGameId: string; externalId: string }[] = [];
    for (const game of input.games) {
      const match = matchByPair.get(pairKey({ sides: sidesOfProviderGame(fieldRowOf(game.homeTeamExternalId), fieldRowOf(game.awayTeamExternalId), false) }));
      const gameOne = match === undefined ? undefined : gameAt.get(JSON.stringify([match.id, 1]));
      if (match === undefined || gameOne === undefined) continue;
      for (const { providerGameId, gameNumber } of game.games) {
        if (heldIds.has(providerGameId) || gameNumber > match.slot.seriesGames) continue;
        const target = gameAt.get(JSON.stringify([match.id, gameNumber]));
        if (target !== undefined && target.externalId !== null) continue;
        const id = target?.game.id ?? randomUUID();
        if (target === undefined) {
          created.push({ id, sportEventId: event.id, sportEventRoundMatchId: match.id, sportEventSlotId: gameOne.game.sportEventSlotId, gameNumber, isNeutralSite: gameOne.game.isNeutralSite });
        }
        mapped.push({ sportEventRoundMatchGameId: id, externalId: providerGameId });
      }
    }
    if (mapped.length === 0) return;
    await this.deps.games.applySync({ providerCode, created, mapped, moved: [], scores: [] });
    this.deps.logger?.info({ sportEventId: event.id, providerId: input.providerId, mapped: mapped.length, created: created.length }, 'Mapped a synced event\'s provider games to its Games');
  }

  /**
   * The event's rounds played in a slot whose definition says neutral site (#2154): a provider game
   * of one is played by neither side at home, whatever the feed says, so it shows "vs".
   */
  private async neutralSiteRounds(sportEventId: string): Promise<ReadonlySet<number>> {
    const rounds = await this.deps.rounds.listRounds(sportEventId);
    return new Set(rounds.filter((round) => round.slot.isNeutralSite).map((round) => round.roundNumber));
  }

  private async syncMatches(
    event: SportEvent,
    input: ProviderGameSlateInput,
    fieldRowOf: (teamExternalId: string) => string,
    neutralRounds: ReadonlySet<number>,
  ): Promise<ProviderGameSlateOutcome> {
    const slate = slateOf(input.games, fieldRowOf, neutralRounds);
    const stored = await this.deps.matches.findBySportEvent(event.id);
    const draft = event.status === SportEventStatus.DRAFT;
    if (draft) {
      // Games with no bracket load only into a one-round event (a game week): on a longer event they
      // are one round's games, and loading them would wipe the bracket an admin built.
      const load = input.bracket !== undefined ? bracketOf(input.bracket, fieldRowOf, neutralRounds) : event.roundCount === 1 ? slate : null;
      const same = load === null || (input.bracket === undefined ? samePairings(stored, load) : sameBracket(stored, load));
      if (!same) {
        await this.deps.bracket.loadBracket(event.id, load);
        this.deps.logger?.info(
          { sportEventId: event.id, providerId: input.providerId, externalId: input.externalId, matchCount: load.length, replaced: stored.length },
          'Loaded a synced event\'s games from its provider',
        );
        const pairings = crossRegionPairings(load);
        if (pairings.length > 0) {
          this.deps.logger?.info(
            { sportEventId: event.id, externalId: input.externalId, crossRegionPairings: pairings },
            'The provider\'s bracket pairs these regions; check them against the official bracket before release',
          );
        }
        return { outcome: 'LOADED', sportEventId: event.id, matchCount: load.length };
      }
      return this.updateMatches(event, stored, slate, []);
    }
    const placed = await this.placeReseededRounds(event, stored, slate);
    const current = placed.length === 0 ? stored : await this.deps.matches.findBySportEvent(event.id);
    return this.updateMatches(event, current, slate, placed);
  }

  /** Moves each round whose matches have a kickoff to the earliest of them; a round with none keeps its date. */
  private async dateRoundsByKickoff(sportEventId: string): Promise<void> {
    const [matches, rounds] = await Promise.all([this.deps.matches.findBySportEvent(sportEventId), this.deps.rounds.listRounds(sportEventId)]);
    const firstKickoff = new Map<number, number>();
    for (const match of matches) {
      if (match.scheduledDate === null) continue;
      const earliest = firstKickoff.get(match.roundNumber);
      if (earliest === undefined || match.scheduledDate.getTime() < earliest) firstKickoff.set(match.roundNumber, match.scheduledDate.getTime());
    }
    const moved = rounds.flatMap((round) => {
      const kickoff = firstKickoff.get(round.roundNumber);
      return kickoff === undefined || kickoff === round.scheduledDate.getTime()
        ? []
        : [{ roundNumber: round.roundNumber, scheduledDate: new Date(kickoff), scheduledEndAt: round.scheduledEndAt }];
    });
    if (moved.length > 0) await this.deps.rounds.reschedule(sportEventId, moved);
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
      this.deps.mappings.findByProviderExternalIds(requireProviderCodeOfSourceId(input.providerId), { sportEventId: event.id }, teamIds),
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
  private async placeReseededRounds(event: SportEvent, stored: readonly SportEventRoundMatch[], slate: readonly BracketMatchInput[]): Promise<MatchPlace[]> {
    const placed: MatchPlace[] = [];
    for (const roundNumber of [...reseededRounds(stored)].sort((left, right) => left - right)) {
      const round = stored.filter((match) => match.roundNumber === roundNumber);
      const games = slate.filter((game) => game.roundNumber === roundNumber);
      const open = round.some((match) => match.sides.some((side) => side.sportEventParticipantId === null));
      if (!open || games.length !== round.length || roundPlacementBlocker(stored, roundNumber) !== null) continue;
      const proposal = await this.deps.bracket.proposeRoundMatchups(event.id, roundNumber);
      const providerPairs = new Set(games.map(pairKey));
      if (!proposal.every((matchup) => providerPairs.has(pairKey(matchup)))) {
        this.deps.logger?.warn(
          { sportEventId: event.id, roundNumber, providerPairings: [...providerPairs], proposedPairings: proposal.map(pairKey) },
          'Left a synced event\'s reseeded round unplaced: its provider pairs the teams differently from the reseed; an admin decides',
        );
        continue;
      }
      await this.deps.bracket.setRoundMatchups(event.id, roundNumber, proposal);
      placed.push(...proposal.map((matchup) => ({ roundNumber, matchNumber: matchup.matchNumber })));
      this.deps.logger?.info({ sportEventId: event.id, roundNumber }, 'Placed a synced event\'s reseeded round from its provider\'s games');
    }
    return placed;
  }

  /**
   * Each stored match of a provider game's two teams takes the game's kickoff while it has not
   * started (a postponed game's new time too, #1791), and where each side plays Game 1 (#2046): a
   * game the provider lists the other way round changes only `homeAway`, never the match's sides.
   */
  private async updateMatches(
    event: SportEvent,
    stored: readonly SportEventRoundMatch[],
    slate: readonly BracketMatchInput[],
    placed: readonly MatchPlace[],
  ): Promise<ProviderGameSlateOutcome> {
    const storedByPair = new Map(stored.map((match) => [pairKey(match), match]));
    const updated: MatchPlace[] = [...placed];
    const unmatched: string[] = [];
    for (const game of slate) {
      const match = storedByPair.get(pairKey(game));
      if (match === undefined) {
        unmatched.push(pairKey(game));
        continue;
      }
      const movesKickoff = isMatchUnplayed(match.status) && game.scheduledDate !== null && !sameTime(match.scheduledDate, game.scheduledDate);
      const gameOne = gameNumbered(match, 1);
      const homeAway = match.sides.map(({ sideNumber, sportEventParticipantId }) => ({
        sideNumber,
        homeAway: game.sides.find((side) => side.sportEventParticipantId === sportEventParticipantId)?.homeAway ?? HomeAway.NONE,
      }));
      const movesHomeAway = gameOne !== null && homeAway.some((side) => homeAwayOf(gameOne, side.sideNumber) !== side.homeAway);
      const patch = {
        ...(movesKickoff && { scheduledDate: game.scheduledDate }),
        ...(movesHomeAway && { gameOneHomeAway: homeAway }),
      };
      if (Object.keys(patch).length === 0) continue;
      await this.deps.bracket.updateMatch(event.id, matchPlaceOf(match), patch);
      if (!updated.some((place) => isAtPlace(match, place))) updated.push(matchPlaceOf(match));
    }
    if (unmatched.length > 0) {
      this.deps.logger?.warn(
        { sportEventId: event.id, unmatchedPairings: unmatched },
        'A released synced event\'s provider changed games its matches hold fixed; an admin decides',
      );
    }
    if (updated.length === 0) return { outcome: 'UNCHANGED', sportEventId: event.id };
    this.deps.logger?.info({ sportEventId: event.id, matches: updated }, 'Kept a synced event\'s matches current with its provider\'s games');
    return { outcome: 'MATCHES_UPDATED', sportEventId: event.id, matches: updated.sort(compareMatchPlaces) };
  }
}

function skipReason(event: SportEvent | null): Extract<ProviderGameSlateOutcome, { outcome: 'SKIPPED' }>['reason'] | null {
  if (event === null) return 'NO_EVENT';
  if (!isProviderSyncedEvent(event)) return 'NOT_SYNCED';
  if (!eventPlaysMatches(event)) return 'PLAYS_NO_GAMES';
  if (isSportEventStatusFinished(event.status)) return 'FINISHED';
  return null;
}

/** The provider's games as the event's matches, in round and kickoff order, numbered within each round (#2161). */
function slateOf(games: readonly ProviderScheduledGame[], fieldRowOf: (teamExternalId: string) => string, neutralRounds: ReadonlySet<number>): BracketMatchInput[] {
  const numbered = new Map<number, number>();
  return [...games]
    .sort(byRoundThenKickoff)
    .map((game) => {
      const matchNumber = (numbered.get(game.roundNumber) ?? 0) + 1;
      numbered.set(game.roundNumber, matchNumber);
      return { game, matchNumber };
    })
    .map(({ game, matchNumber }) => ({
      matchNumber,
      roundNumber: game.roundNumber,
      sides: sidesOfProviderGame(fieldRowOf(game.homeTeamExternalId), fieldRowOf(game.awayTeamExternalId), neutralRounds.has(game.roundNumber)),
      isNeutralSite: neutralRounds.has(game.roundNumber),
      scheduledDate: game.scheduledAt,
      advancesTo: null,
    }));
}

/**
 * Each match whose two feeders come from different regions, with the regions in it: an NCAA
 * national semifinal, which the provider's bracket pairs by a guess an admin checks (#1728).
 */
function crossRegionPairings(bracket: readonly BracketMatchInput[]): Array<MatchPlace & { regions: string[] }> {
  const regionsByMatch = new Map<BracketMatchInput, string[]>();
  for (const match of bracket) {
    const { advancesTo, regionLabel } = match;
    if (advancesTo === null || regionLabel === undefined || regionLabel === null) continue;
    const target = bracket.find((candidate) => isAtPlace(candidate, advancesTo));
    if (target === undefined || target.regionLabel === regionLabel) continue;
    const regions = regionsByMatch.get(target) ?? [];
    if (!regions.includes(regionLabel)) regions.push(regionLabel);
    regionsByMatch.set(target, regions);
  }
  return [...regionsByMatch]
    .filter(([, regions]) => regions.length > 1)
    .map(([target, regions]) => ({ ...matchPlaceOf(target), regions }))
    .sort(compareMatchPlaces);
}

/** The provider's bracket as the event's, each named side its team's field row. */
function bracketOf(bracket: readonly ProviderBracketMatch[], fieldRowOf: (teamExternalId: string) => string, neutralRounds: ReadonlySet<number>): BracketMatchInput[] {
  return bracket.map((match) => ({
    matchNumber: match.matchNumber,
    roundNumber: match.roundNumber,
    sides: sidesOfProviderGame(
      match.homeTeamExternalId === null ? null : fieldRowOf(match.homeTeamExternalId),
      match.awayTeamExternalId === null ? null : fieldRowOf(match.awayTeamExternalId),
      neutralRounds.has(match.roundNumber),
    ),
    isNeutralSite: neutralRounds.has(match.roundNumber),
    scheduledDate: match.scheduledAt,
    advancesTo: match.advancesTo === null ? null : {
      roundNumber: match.advancesTo.roundNumber,
      matchNumber: match.advancesTo.matchNumber,
      sideNumber: sideNumberOfMatchSide(match.advancesTo.side),
    },
    regionLabel: match.regionLabel,
  }));
}

function byRoundThenKickoff(left: ProviderScheduledGame, right: ProviderScheduledGame): number {
  return left.roundNumber - right.roundNumber
    || (left.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
    || gameOneId(left).localeCompare(gameOneId(right));
}

/** The provider's id for the match's Game 1, which orders matches that kick off together. */
function gameOneId(game: ProviderScheduledGame): string {
  return game.games.find((each) => each.gameNumber === 1)?.providerGameId ?? '';
}

/** A match's two teams, whichever side each is on. */
function pairKey(match: { sides: readonly { sportEventParticipantId: string | null }[] }): string {
  return match.sides.map((side) => side.sportEventParticipantId ?? '-').sort().join('|');
}

function sameTime(left: Date | null, right: Date | null): boolean {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

/** Whether the stored bracket has the provider's shape and teams, match by match, kickoffs aside. */
function sameBracket(stored: readonly SportEventRoundMatch[], bracket: readonly BracketMatchInput[]): boolean {
  if (stored.length !== bracket.length) return false;
  const storedById = new Map(stored.map((match) => [match.id, match]));
  const storedByPlace = new MatchPlaceMap(stored.map((match) => [match, match] as const));
  return bracket.every((slot) => {
    const match = storedByPlace.get(slot);
    if (match === undefined) return false;
    const next = match.advancesToMatchId === null ? undefined : storedById.get(match.advancesToMatchId);
    const advancesAlike = slot.advancesTo === null
      ? match.advancesToMatchId === null
      : next !== undefined && isAtPlace(next, slot.advancesTo) && match.advancesToSideNumber === slot.advancesTo.sideNumber;
    return advancesAlike
      && slot.sides.every((side) => sideParticipantId(match, side.sideNumber) === side.sportEventParticipantId)
      && matchIsNeutralSite(match) === slot.isNeutralSite
      && match.regionLabel === (slot.regionLabel ?? null);
  });
}

/** Whether the stored matches pair the same teams as the provider's games, kickoffs and sides aside. */
function samePairings(stored: readonly SportEventRoundMatch[], slate: readonly BracketMatchInput[]): boolean {
  if (stored.length !== slate.length) return false;
  const storedPairs = new Set(stored.map((match) => pairKey(match)));
  return slate.every((match) => storedPairs.has(pairKey(match)));
}
