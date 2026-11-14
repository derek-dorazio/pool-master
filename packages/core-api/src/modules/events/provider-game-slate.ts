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
  | { outcome: 'KICKOFFS_MOVED'; sportEventId: string; matchNumbers: number[] }
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

/** The match fields a slate decides, to tell whether the stored games already are the slate. */
type SlateKey = Pick<BracketMatchInput, 'matchNumber' | 'roundNumber' | 'homeSportEventParticipantId' | 'awaySportEventParticipantId' | 'isNeutralSite' | 'scheduledDate'>;

/**
 * A synced sport league's event takes its games from its provider (ADR 0011, #1728): a game
 * week's games (an NFL week, a Premier League matchweek) become the event's matches, as an admin
 * would load them through `loadBracket`. While the event is a draft the provider's slate replaces
 * whatever is stored when it differs: the provider wins, and nobody can have picked yet. Once
 * the event is released its pairings are fixed, so only a game's kickoff follows the provider, on
 * a match not yet started; a pairing the provider changes after release is logged for an admin.
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
    if (event.status === SportEventStatus.DRAFT) {
      if (sameSlate(stored, slate)) return { outcome: 'UNCHANGED', sportEventId: event.id };
      await this.deps.bracket.loadBracket(event.id, slate);
      this.deps.logger?.info(
        { sportEventId: event.id, providerId: input.providerId, externalId: input.externalId, matchCount: slate.length, replaced: stored.length },
        'Loaded a synced event\'s games from its provider',
      );
      return { outcome: 'LOADED', sportEventId: event.id, matchCount: slate.length };
    }
    return this.moveKickoffs(event, stored, slate);
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

  /** A released event: each not-yet-started match of the same two teams takes the provider's kickoff. */
  private async moveKickoffs(event: SportEvent, stored: readonly SportEventMatch[], slate: readonly BracketMatchInput[]): Promise<ProviderGameSlateOutcome> {
    const storedByPair = new Map(stored.map((match) => [pairKey(match), match]));
    const moved: number[] = [];
    const unmatched: string[] = [];
    for (const game of slate) {
      const match = storedByPair.get(pairKey(game));
      if (match === undefined) {
        unmatched.push(pairKey(game));
        continue;
      }
      if (match.status !== MatchStatus.SCHEDULED || sameTime(match.scheduledDate, game.scheduledDate) || game.scheduledDate === null) continue;
      await this.deps.bracket.updateMatch(event.id, match.matchNumber, { scheduledDate: game.scheduledDate });
      moved.push(match.matchNumber);
    }
    if (unmatched.length > 0) {
      this.deps.logger?.warn(
        { sportEventId: event.id, unmatchedPairings: unmatched },
        'A released synced event\'s provider lists games its matches do not hold; an admin decides',
      );
    }
    if (moved.length === 0) return { outcome: 'UNCHANGED', sportEventId: event.id };
    this.deps.logger?.info({ sportEventId: event.id, matchNumbers: moved }, 'Moved a synced event\'s kickoffs to its provider\'s');
    return { outcome: 'KICKOFFS_MOVED', sportEventId: event.id, matchNumbers: moved };
  }
}

function skipReason(event: SportEvent | null): Exclude<ProviderGameSlateOutcome, { outcome: 'LOADED' | 'KICKOFFS_MOVED' | 'UNCHANGED' }>['reason'] | null {
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

function pairKey(match: Pick<BracketMatchInput, 'homeSportEventParticipantId' | 'awaySportEventParticipantId'>): string {
  return `${match.homeSportEventParticipantId ?? '-'}@${match.awaySportEventParticipantId ?? '-'}`;
}

function sameTime(left: Date | null, right: Date | null): boolean {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

function slateKey(match: SlateKey): string {
  return [match.matchNumber, match.roundNumber, match.homeSportEventParticipantId, match.awaySportEventParticipantId, match.isNeutralSite, match.scheduledDate?.toISOString() ?? null].join('|');
}

/** Whether the stored matches already are the provider's slate, match for match. */
function sameSlate(stored: readonly SportEventMatch[], slate: readonly BracketMatchInput[]): boolean {
  if (stored.length !== slate.length) return false;
  const storedKeys = new Set(stored.map(slateKey));
  return slate.every((match) => storedKeys.has(slateKey(match)));
}
