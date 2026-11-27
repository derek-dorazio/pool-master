/**
 * SportEventParticipantService — an event's field: who is competing, each field row's
 * event-scoped state, and the read every screen of an event's participants uses
 * (plans/124 §4.7, #236).
 *
 * `listEventParticipants` is that one read. It returns each field row with its canonical
 * participant, valuation, standing and rounds — the core row plus the sport's extension
 * at each level — so the field grid, the scores screen and the event browser all read
 * the same object. Before #236 those were three projections of these rows. Since #1163 it
 * is one repository call, and what viewers poll, `listCachedEventParticipants`, is shared
 * by every contest on the event for up to 30 seconds.
 *
 * `addParticipants` adds anyone to the field (a LIV golfer at a PGA event): a field is never
 * constrained to its sport league's roster.
 *
 * A field's rankings, seeds and withdrawals come from the feed (#2008); a root admin's edit goes
 * through `updateParticipants`, the grid save, so a field edit has one write path.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantRepository,
  SportEventParticipantPatch,
  SportEventRoundMatchRepository,
  SportEventParticipantRepository,
  SportEventParticipantView,
  SportEventSlotParticipantValuationRepository,
  SportEventRepository,
  SportEventSlotTierRepository,
} from '@poolmaster/shared/db';
import {
  eventPlaysMatches,
  SportEventStatus,
  tierSetSlotOf,
  type SportEvent,
  type SportEventTierSlot,
  type SportEventParticipant,
  sideOfParticipant,
} from '@poolmaster/shared/domain';
import type { JobsForWrite } from '../background-jobs/background-job-queue';
import { DomainEventType, type DomainEvents } from '../domain-events';
import { SportEventError } from './errors';
import type { EventFieldCache } from './event-field-cache';
import { EventFieldReader, type EventFieldReads } from './event-field-reader';
import { assertTierSetEditable, requireTierSetSlot } from './sport-event-tier-service';

// The field row a reader sees lives with the port that reads it (#1163).
export type { ParticipantRoundView, ParticipantStandingView, SportEventParticipantView } from '@poolmaster/shared/db';

export interface AddFieldResult {
  added: number;
  skipped: number;
  total: number;
}

export interface FieldEntryUpdate extends SportEventParticipantPatch {
  sportEventParticipantId: string;
  price?: number | null;
  /** A manual move into this tier, placed last in it. */
  tierKey?: string;
}

/** The values of `patch` that differ from the field row's, so a value sent unchanged is not written again. */
function changedValues(entry: SportEventParticipant, patch: SportEventParticipantPatch): SportEventParticipantPatch {
  const changed: SportEventParticipantPatch = {};
  if (patch.status !== undefined && patch.status !== entry.status) changed.status = patch.status;
  if (patch.ranking !== undefined && patch.ranking !== (entry.ranking ?? null)) changed.ranking = patch.ranking;
  if (patch.oddsToWin !== undefined && patch.oddsToWin !== (entry.oddsToWin ?? null)) changed.oddsToWin = patch.oddsToWin;
  if (patch.seedNumber !== undefined && patch.seedNumber !== (entry.seedNumber ?? null)) changed.seedNumber = patch.seedNumber;
  return changed;
}

export interface SportEventParticipantServiceDeps {
  sportEvents: SportEventRepository;
  field: SportEventParticipantRepository;
  participants: ParticipantRepository;
  matches: Pick<SportEventRoundMatchRepository, 'findBySportEvent'>;
  /**
   * The event's tier-set slot, whose set a price or tier in a save goes into (#2044), and that set's
   * tiers and valuations, read when a save moves a participant into another tier.
   */
  tiers: Pick<SportEventSlotTierRepository, 'findTierSlots' | 'findBySlot'>;
  valuations: Pick<SportEventSlotParticipantValuationRepository, 'findBySlot'>;
  /** The fields read lately, shared by every instance of this service in the container; a new one when omitted. */
  fieldCache?: EventFieldCache;
  /** What follows each results, field or game change it writes (#1946): the app's one map. */
  domainEvents: Pick<DomainEvents, 'collect'>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

export type { EventFieldReads } from './event-field-reader';

/** Where a tier move in a field save lands in the slot's set. */
type TierMove = { sportEventSlotTierId: string; tierOrderIndex: number };

export class SportEventParticipantService implements EventFieldReads {
  /** The field's reads (#1163, #1315), which the contest and email readers are built with alone. */
  private readonly fieldReader: EventFieldReader;

  constructor(private readonly deps: SportEventParticipantServiceDeps) {
    this.fieldReader = new EventFieldReader(deps);
  }

  listEventParticipants(sportEventId: string): Promise<SportEventParticipantView[]> {
    return this.fieldReader.listEventParticipants(sportEventId);
  }

  listCachedEventParticipants(sportEventId: string): Promise<SportEventParticipantView[]> {
    return this.fieldReader.listCachedEventParticipants(sportEventId);
  }

  batchedFieldReads(): EventFieldReads {
    return this.fieldReader.batchedFieldReads();
  }

  /**
   * One field row, read as the field reads each (#1163): what a write to one row answers with.
   * 404 EVENT_NOT_FOUND for an unknown event, EVENT_PARTICIPANT_NOT_FOUND for a row not on it.
   */
  async getEventParticipant(sportEventId: string, sportEventParticipantId: string): Promise<SportEventParticipantView> {
    const event = await this.requireEvent(sportEventId);
    const row = await this.deps.field.findFieldRow(sportEventId, sportEventParticipantId, event.sportLeagueId);
    if (!row) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} is not on sport event ${sportEventId}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    return row;
  }

  /**
   * Adds any participants to the field; idempotent for ones already on it. A test participant
   * joins only a test slot's event (#2096): 422 TEST_PARTICIPANT_NOT_ON_TEST_SLOT otherwise.
   */
  async addParticipants(sportEventId: string, participantIds: readonly string[]): Promise<AddFieldResult> {
    await this.requireEvent(sportEventId);
    const onField = new Set((await this.deps.field.findBySportEvent(sportEventId)).map((entry) => entry.participantId));
    const toAdd = [...new Set(participantIds)].filter((participantId) => !onField.has(participantId));
    if (toAdd.length > 0) await this.assertTestParticipantsFit(sportEventId, toAdd);
    if (toAdd.length > 0) {
      const rebuild = await this.rebuild(sportEventId);
      await this.deps.field.createMany(sportEventId, toAdd.map((participantId) => ({ participantId })), rebuild.jobs);
      rebuild.queued();
    }
    this.deps.logger?.info(
      { sportEventId, added: toAdd.length, skipped: participantIds.length - toAdd.length },
      'Added participants to the field',
    );
    return { added: toAdd.length, skipped: participantIds.length - toAdd.length, total: participantIds.length };
  }

  /**
   * One save of the field grid: every patched row and its manual price, all or none; a price or a
   * tier move goes into the event's tier-set slot's set (#2044). Rank, odds, seed and withdrawals
   * stay editable after release; a price does not (409
   * SPORT_EVENT_TIERS_LOCKED, #431), and neither does a seed on an event played as a bracket,
   * whose upset bonus reads the seeds as they stood at release (409 SPORT_EVENT_SEEDS_LOCKED,
   * #698). A seed sent unchanged is not a change.
   */
  async updateParticipants(sportEventId: string, updates: readonly FieldEntryUpdate[]): Promise<SportEventParticipantView[]> {
    const event = await this.requireEvent(sportEventId);
    const valued = await this.valuedSlot(event, updates);
    const field = await this.deps.field.findBySportEvent(sportEventId);
    const seedsLocked = eventPlaysMatches(event) && event.status !== SportEventStatus.DRAFT;
    if (seedsLocked) {
      const seedById = new Map(field.map((entry) => [entry.id, entry.seedNumber ?? null]));
      const reseeded = updates.filter((update) => update.seedNumber !== undefined
        && seedById.has(update.sportEventParticipantId)
        && update.seedNumber !== seedById.get(update.sportEventParticipantId));
      if (reseeded.length > 0) {
        this.deps.logger?.warn({ sportEventId, status: event.status, reseeded: reseeded.length }, 'Refused a seed change on a released bracket');
        throw new SportEventError(
          `Sport event ${sportEventId} has been released for contests, so its seeds are locked.`,
          'SPORT_EVENT_SEEDS_LOCKED',
          409,
        );
      }
    }
    const onField = new Set(field.map((entry) => entry.id));
    const notOnField = updates.filter((update) => !onField.has(update.sportEventParticipantId));
    if (notOnField.length > 0) {
      throw new SportEventError(
        `Not on sport event ${sportEventId}'s field: ${notOnField.map((update) => update.sportEventParticipantId).join(', ')}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    // Only the values that change are written, so a grid saved with most rows untouched writes
    // little: the adapter writes one statement per distinct new value (#1252).
    const entryById = new Map(field.map((entry) => [entry.id, entry]));
    const tierMoves = valued === null ? new Map<string, TierMove>() : await this.tierMoves(sportEventId, valued, updates);
    const rebuild = await this.rebuild(sportEventId);
    await this.deps.field.updateMany(updates.map(({ sportEventParticipantId, price, tierKey: _tierKey, ...patch }) => {
      const entry = entryById.get(sportEventParticipantId);
      const tier = tierMoves.get(sportEventParticipantId);
      return {
        id: sportEventParticipantId,
        updates: entry ? changedValues(entry, patch) : patch,
        ...(valued !== null && (price !== undefined || tier !== undefined) && { valuation: { slot: valued, price, tier } }),
      };
    }), rebuild.jobs);
    rebuild.queued();
    return this.listEventParticipants(sportEventId);
  }

  /**
   * The event's tier-set slot (#2044), when the save sets a price or moves a tier: the set they go
   * into, checked editable (409 SPORT_EVENT_TIERS_LOCKED, 409 SPORT_EVENT_HAS_NO_SLOT). Null for a
   * save that touches neither, which reads nothing.
   */
  private async valuedSlot(event: SportEvent, updates: readonly FieldEntryUpdate[]): Promise<SportEventTierSlot | null> {
    if (!updates.some((update) => update.price !== undefined || update.tierKey !== undefined)) return null;
    const slot = requireTierSetSlot(event.id, tierSetSlotOf((await this.deps.tiers.findTierSlots([event.id])).get(event.id) ?? []));
    try {
      assertTierSetEditable(event, slot);
    } catch (error) {
      this.deps.logger?.warn({ sportEventId: event.id, sportEventSlotId: slot.id, status: event.status }, 'Refused a tier or price change on a locked tier set');
      throw error;
    }
    return slot;
  }

  /**
   * Where each tier move in a save lands: last in its new tier of the slot's set, after the
   * highest place already held there, so a tier with gaps in its order never gets a place twice.
   * Nothing is read when the save moves no one. 422 UNKNOWN_TIER_KEY for a key the set has no
   * tier for.
   */
  private async tierMoves(
    sportEventId: string,
    slot: SportEventTierSlot,
    updates: readonly FieldEntryUpdate[],
  ): Promise<Map<string, TierMove>> {
    const moves = updates.filter((update): update is FieldEntryUpdate & { tierKey: string } => update.tierKey !== undefined);
    if (moves.length === 0) return new Map();
    const [tiers, valuations] = await Promise.all([
      this.deps.tiers.findBySlot(slot.id),
      this.deps.valuations.findBySlot(slot.id),
    ]);
    const tierIdByKey = new Map(tiers.map((tier) => [tier.tierKey, tier.id]));
    const unknownKeys = [...new Set(moves.map((move) => move.tierKey))].filter((key) => !tierIdByKey.has(key));
    if (unknownKeys.length > 0) {
      this.deps.logger?.warn({ sportEventId, unknownKeys }, 'Refused a move into a tier the event does not have');
      throw new SportEventError(`Unknown tier key(s): ${unknownKeys.join(', ')}.`, 'UNKNOWN_TIER_KEY', 422);
    }
    const moving = new Set(moves.map((move) => move.sportEventParticipantId));
    const nextPlace = new Map<string, number>();
    for (const valuation of valuations) {
      if (valuation.sportEventSlotTierId === null || moving.has(valuation.sportEventParticipantId)) continue;
      const place = (valuation.tierOrderIndex ?? -1) + 1;
      nextPlace.set(valuation.sportEventSlotTierId, Math.max(nextPlace.get(valuation.sportEventSlotTierId) ?? 0, place));
    }
    const placed = new Map<string, TierMove>();
    for (const move of moves) {
      const sportEventSlotTierId = tierIdByKey.get(move.tierKey) as string;
      const tierOrderIndex = nextPlace.get(sportEventSlotTierId) ?? 0;
      nextPlace.set(sportEventSlotTierId, tierOrderIndex + 1);
      placed.set(move.sportEventParticipantId, { sportEventSlotTierId, tierOrderIndex });
    }
    return placed;
  }

  /**
   * Removes a field row. Refused (409) once any contest entry has picked it — withdraw instead —
   * and while a bracket match names it (#698).
   */
  async removeParticipant(sportEventId: string, sportEventParticipantId: string): Promise<void> {
    const entry = await this.deps.field.findById(sportEventParticipantId);
    if (!entry || entry.sportEventId !== sportEventId) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} is not on sport event ${sportEventId}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    const picks = await this.deps.field.countPicks(sportEventParticipantId);
    if (picks > 0) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} has ${picks} contest entry pick(s) and cannot be removed — withdraw it instead.`,
        'EVENT_PARTICIPANT_HAS_PICKS',
        409,
      );
    }
    const inBracket = (await this.deps.matches.findBySportEvent(sportEventId)).some((match) => (
      sideOfParticipant(match, sportEventParticipantId) !== null
    ));
    if (inBracket) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} is in the event's bracket and cannot be removed — take it out of its match first.`,
        'EVENT_PARTICIPANT_IN_BRACKET',
        409,
      );
    }
    const rebuild = await this.rebuild(sportEventId);
    await this.deps.field.delete(sportEventParticipantId, rebuild.jobs);
    rebuild.queued();
  }

  /** The job rebuilding the event's boards, written with a field write that may change them (#1466, #1946). */
  private rebuild(sportEventId: string): Promise<JobsForWrite> {
    return this.deps.domainEvents.collect({ type: DomainEventType.SPORT_EVENT_RESULTS_CHANGED, sportEventId });
  }

  /** A test participant joins only a test slot's event (#2096); the event is read only when one is added. */
  private async assertTestParticipantsFit(sportEventId: string, participantIds: readonly string[]): Promise<void> {
    const testParticipants = (await this.deps.participants.findByIds(participantIds)).filter((participant) => participant.isTestData);
    if (testParticipants.length === 0 || await this.deps.sportEvents.isTestEvent(sportEventId) === true) return;
    this.deps.logger?.warn({ sportEventId, testParticipants: testParticipants.length }, 'Refused a test participant on an event the sync keeps');
    throw new SportEventError(
      'A test participant can only join the field of an event on a test slot.',
      'TEST_PARTICIPANT_NOT_ON_TEST_SLOT',
      422,
    );
  }

  private async requireEvent(sportEventId: string): Promise<SportEvent> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event) {
      throw new SportEventError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    return event;
  }
}
