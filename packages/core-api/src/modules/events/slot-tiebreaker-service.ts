/**
 * An event slot's tiebreaker game (#2048, plan §9c): the one Game whose combined score every
 * contest covering the slot guesses. This service is its one writer.
 *
 * - **The rule** (`chooseSlotTiebreakerGame`) chooses it as soon as the slot has a Game: the
 *   latest scheduled start, ties to the lower Game id; a Game with no start yet ranks after every
 *   scheduled one, the later round first, so a bracket's final is its tiebreaker game from entry time.
 * - **It runs again** after each write to the event's games (the `REFRESH_SLOT_TIEBREAKERS` job),
 *   so a schedule change moves it, until the chosen Game starts; from then on it is fixed.
 * - **A root admin can choose another** of the slot's Games until the chosen one starts. Who chose
 *   it and when are kept on the slot and logged; the rule leaves an admin's choice alone.
 * - **A cancelled or moved game** is replaced by the rule's choice whoever chose it, started or
 *   not, and raises a TIEBREAKER_GAME_REPLACED finding. Guesses are kept on the entries, so they
 *   carry over to the new game.
 *
 * Each write tells the event's results changed, so its contests' boards are rebuilt with it.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SlotTiebreakerGame, SlotTiebreakerRepository, SlotTiebreakerState, SlotTiebreakerWrite } from '@poolmaster/shared/db';
import {
  MatchStatus,
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  canBeSlotTiebreaker,
  chooseSlotTiebreakerGame,
  hasTiebreakerGameStarted,
  type ProviderSyncFindingRaise,
} from '@poolmaster/shared/domain';
import { DomainEventType, type DomainEvents } from '../domain-events';
import type { ProviderSyncFindingService } from '../ingestion/findings/provider-sync-finding-service';
import { SportEventError } from './errors';

export interface SlotTiebreakerServiceDeps {
  slots: SlotTiebreakerRepository;
  findings: Pick<ProviderSyncFindingService, 'raise'>;
  domainEvents: Pick<DomainEvents, 'collect'>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

/** One of a slot's Games as the slot dialog offers it. */
export interface SlotTiebreakerOption extends SlotTiebreakerGame {
  /** Whether a root admin can choose it now: the rule could, and it has not started. */
  choosable: boolean;
}

/** One slot's tiebreaker game as the slot dialog reads it. */
export interface SlotTiebreakerView {
  seasonSlotId: string;
  tiebreakerGameId: string | null;
  /** Set while a root admin's choice stands. */
  chosen: SlotTiebreakerState['chosen'];
  /** Whether it can be changed: no game is chosen yet, or the chosen one has not started. */
  editable: boolean;
  games: SlotTiebreakerOption[];
}

/** What one run of the rule over an event's slots did. */
export interface SlotTiebreakerRefresh {
  changedCount: number;
  replacedCount: number;
}

export class SlotTiebreakerService {
  constructor(private readonly deps: SlotTiebreakerServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Each slot of the event with its tiebreaker game and the Games it could be. */
  async listSlotTiebreakers(sportEventId: string): Promise<SlotTiebreakerView[]> {
    const now = this.now();
    const slots = await this.deps.slots.findBySportEvent(sportEventId);
    return slots.map((slot) => viewOf(slot, now));
  }

  /**
   * Runs the rule for each slot of the event and writes what changed: the job's handler. A slot
   * whose game has started, or whose game a root admin chose, keeps it, unless it was cancelled or
   * moved out of the slot.
   */
  async refresh(sportEventId: string): Promise<SlotTiebreakerRefresh> {
    const now = this.now();
    const slots = await this.deps.slots.findBySportEvent(sportEventId);
    const writes: SlotTiebreakerWrite[] = [];
    const replaced: SlotTiebreakerState[] = [];
    for (const slot of slots) {
      const current = slot.games.find((game) => game.id === slot.tiebreakerGameId) ?? null;
      const lost = current !== null && (current.moved || current.status === MatchStatus.CANCELLED);
      if (!lost && current !== null && (hasTiebreakerGameStarted(current, now) || slot.chosen !== null)) continue;
      const next = chooseSlotTiebreakerGame(slot.games);
      if (!lost && (next?.id ?? null) === slot.tiebreakerGameId) continue;
      writes.push({ sportEventSlotId: slot.sportEventSlotId, tiebreakerGameId: next?.id ?? null, chosen: null });
      if (lost) replaced.push(slot);
      this.deps.logger?.info(
        { action: 'events.slotTiebreaker.chosenByRule', data: { sportEventId, seasonSlotId: slot.seasonSlotId, from: slot.tiebreakerGameId, to: next?.id ?? null, replaced: lost } },
        'Chose a slot\'s tiebreaker game by the rule',
      );
    }
    await this.save(sportEventId, writes);
    await this.deps.findings.raise(replaced.map((slot) => replacedFinding(slot, sportEventId)));
    return { changedCount: writes.length, replacedCount: replaced.length };
  }

  /**
   * A root admin chooses the slot's tiebreaker game. 404 SEASON_SLOT_NOT_FOUND for a slot the
   * event does not cover; 422 TIEBREAKER_GAME_NOT_IN_SLOT for a Game played elsewhere, and
   * TIEBREAKER_GAME_NOT_ELIGIBLE for one cancelled, moved or with no start; 409
   * TIEBREAKER_GAME_STARTED once the slot's game, or the one asked for, has started. Choosing the
   * game already chosen still records the choice.
   */
  async chooseTiebreakerGame(sportEventId: string, seasonSlotId: string, gameId: string, actorUserId: string): Promise<SlotTiebreakerView> {
    const now = this.now();
    const slots = await this.deps.slots.findBySportEvent(sportEventId);
    const slot = slots.find((each) => each.seasonSlotId === seasonSlotId);
    if (slot === undefined) {
      throw new SportEventError(`Sport event ${sportEventId} covers no Season slot ${seasonSlotId}.`, 'SEASON_SLOT_NOT_FOUND', 404);
    }
    const game = slot.games.find((each) => each.id === gameId);
    if (game === undefined) {
      throw new SportEventError(`Game ${gameId} is not played in the slot.`, 'TIEBREAKER_GAME_NOT_IN_SLOT', 422);
    }
    if (!canBeSlotTiebreaker(game)) {
      throw new SportEventError(`Game ${gameId} is cancelled or moved.`, 'TIEBREAKER_GAME_NOT_ELIGIBLE', 422);
    }
    const current = slot.games.find((each) => each.id === slot.tiebreakerGameId) ?? null;
    if ((current !== null && hasTiebreakerGameStarted(current, now)) || hasTiebreakerGameStarted(game, now)) {
      throw new SportEventError('The tiebreaker game has started.', 'TIEBREAKER_GAME_STARTED', 409);
    }
    const chosen = { at: now, byUserId: actorUserId };
    await this.save(sportEventId, [{ sportEventSlotId: slot.sportEventSlotId, tiebreakerGameId: game.id, chosen }]);
    this.deps.logger?.info(
      { action: 'events.slotTiebreaker.chosenByAdmin', userId: actorUserId, data: { sportEventId, seasonSlotId, from: slot.tiebreakerGameId, to: game.id } },
      'A root admin chose a slot\'s tiebreaker game',
    );
    return viewOf({ ...slot, tiebreakerGameId: game.id, chosen }, now);
  }

  /** Writes the slots' new games with the jobs a change to the event's results carries. */
  private async save(sportEventId: string, writes: readonly SlotTiebreakerWrite[]): Promise<void> {
    if (writes.length === 0) return;
    const changed = await this.deps.domainEvents.collect({ type: DomainEventType.SPORT_EVENT_RESULTS_CHANGED, sportEventId });
    await this.deps.slots.saveTiebreakerGames(writes, changed.jobs);
    changed.queued();
  }
}

function viewOf(slot: SlotTiebreakerState, now: Date): SlotTiebreakerView {
  const current = slot.games.find((game) => game.id === slot.tiebreakerGameId) ?? null;
  const editable = current === null || !hasTiebreakerGameStarted(current, now);
  return {
    seasonSlotId: slot.seasonSlotId,
    tiebreakerGameId: slot.tiebreakerGameId,
    chosen: slot.chosen,
    editable,
    games: slot.games.map((game) => ({ ...game, choosable: editable && canBeSlotTiebreaker(game) && !hasTiebreakerGameStarted(game, now) })),
  };
}

function replacedFinding(slot: SlotTiebreakerState, sportEventId: string): ProviderSyncFindingRaise {
  return {
    kind: ProviderSyncFindingKind.TIEBREAKER_GAME_REPLACED,
    severity: ProviderSyncFindingSeverity.WARNING,
    sportLeagueId: slot.sportLeagueId,
    sportEventId,
    providerId: null,
    providerValue: null,
    providerValueName: null,
  };
}
