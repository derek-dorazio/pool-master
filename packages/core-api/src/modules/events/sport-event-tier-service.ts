/**
 * SportEventTierService — an event's pick tiers and each field row's valuation: its tier
 * placement and its price (plans/124 §4.5/§4.7a). Cross-sport: tiers and prices are pool
 * mechanics, not golf (#203 stage 2, decision 3).
 *
 * Tiers and prices are event-level only, never a per-contest override (plans/124 §4.6).
 * `getEffectiveTiersAndValuations` (and its two one-view shorthands) is the one path every
 * contest-side reader (selections, contest configuration, the entry email) takes.
 * The valuation view reads valuations directly rather than through the tiers, because a
 * valuation can carry a price with no tier (a budget-format contest), and a query that
 * starts from the tiers would never see it.
 *
 * Tiers and prices are set while the event is a DRAFT and lock for good when it is released
 * (#431): every write here refuses with 409 SPORT_EVENT_TIERS_LOCKED after that, so a saved
 * entry can never be broken by a tier or price moving under it. A participant added to the
 * field after release stays untiered and can't be picked.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantRepository,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
  SportEventRepository,
  SportEventTierDefinition,
  SportEventTierRepository,
} from '@poolmaster/shared/db';
import {
  findBudgetPricingProblem,
  eventSportDefinition,
  FieldOrderBasis,
  orderField,
  SportEventStatus,
  ValuationSource,
  type EventPricingConfig,
  type SportDefinition,
  type SportEvent,
  type SportEventParticipant,
  type SportEventParticipantValuation,
  type SportEventTier,
} from '@poolmaster/shared/domain';
import { deriveGolfPrices } from '../golf/golf-seeding-algorithm';
import { SportEventError } from './errors';

/** One field row's place in a tier. */
export interface TierPlacement {
  sportEventParticipantId: string;
  participantId: string;
  tierOrderIndex: number | null;
  price: number | null;
}

/** A tier with the field rows placed in it, in tier order. */
export interface SportEventTierGroup extends SportEventTier {
  participants: TierPlacement[];
}

/** One field row's effective tier and price; the tier fields and the price are independently nullable. */
export interface ParticipantValuationView {
  sportEventParticipantId: string;
  participantId: string;
  tierId: string | null;
  tierKey: string | null;
  tierLabel: string | null;
  tierNumber: number | null;
  tierOrderIndex: number | null;
  price: number | null;
}

/** What a field sync's tiering did (#1822): made or found already made, kept as an admin edited them, or none because the event has no tiers. */
export type SyncedTiers =
  | { result: 'MADE' | 'UNCHANGED'; basis: FieldOrderBasis; tierCount: number }
  | { result: 'KEPT_AS_EDITED' | 'NO_TIERS' };

/** What a field sync's pricing did (#1822): made or found already made, or kept as an admin edited them. */
export type SyncedPrices =
  | { result: 'MADE' | 'UNCHANGED'; basis: FieldOrderBasis; pricedCount: number; profileName: string }
  | { result: 'KEPT_AS_EDITED' };

/** What tiering and pricing a synced field did, or why it did neither. */
export type SyncedFieldValuation =
  | { outcome: 'VALUED'; sportEventId: string; tiers: SyncedTiers; prices: SyncedPrices }
  | { outcome: 'SKIPPED'; reason: 'LOCKED' | 'NO_FIELD' };

/**
 * Refuses a tier or price change once the event is released (#431). The field grid's price
 * column goes through this too, so there is one lock rule.
 */
export function assertTiersAndPricesEditable(event: SportEvent): void {
  if (event.status !== SportEventStatus.DRAFT) {
    throw new SportEventError(
      `Sport event ${event.id} has been released for contests, so its tiers and prices are locked.`,
      'SPORT_EVENT_TIERS_LOCKED',
      409,
    );
  }
}

export interface SportEventTierServiceDeps {
  sportEvents: Pick<SportEventRepository, 'findById'>;
  tiers: SportEventTierRepository;
  valuations: SportEventParticipantValuationRepository;
  field: SportEventParticipantRepository;
  /** The field's names, the order's last tie-break (#1807). */
  participants: Pick<ParticipantRepository, 'findByIds'>;
  logger?: FastifyBaseLogger;
}

export class SportEventTierService {
  constructor(private readonly deps: SportEventTierServiceDeps) {}

  listTiers(sportEventId: string): Promise<SportEventTier[]> {
    return this.deps.tiers.findBySportEvent(sportEventId);
  }

  /** Every event's tiers from one read, each in tier order (#1355). */
  listTiersOfEvents(sportEventIds: readonly string[]): Promise<SportEventTier[]> {
    return this.deps.tiers.findBySportEvents(sportEventIds);
  }

  /**
   * New events' default tiers, every event's in one insert (#1253): the sport league's tier count
   * where it sets one (the College Football Playoff: six), else the sport's (golf: six). A
   * default, fully editable afterwards; the tier count is however many rows exist, not a stored
   * parameter (plans/124 §4.5a). The events have no tiers yet: an event is created with them.
   * Answers each event's tiers as written.
   */
  async createDefaultTiers(
    events: ReadonlyArray<{ sportEventId: string; definition: SportDefinition; leagueTierCount: number | null }>,
  ): Promise<Map<string, SportEventTierDefinition[]>> {
    const tiersByEvent = new Map(events.map(({ sportEventId, definition, leagueTierCount }) => [
      sportEventId,
      Array.from({ length: leagueTierCount ?? definition.defaultTierLayout.tierCount }, (_, index) => ({
        tierKey: `tier-${index + 1}`,
        label: `Tier ${index + 1}`,
        tierNumber: index + 1,
      })),
    ]));
    await this.deps.tiers.createMany([...tiersByEvent].flatMap(([sportEventId, tiers]) => tiers.map((tier) => ({ sportEventId, ...tier }))));
    this.deps.logger?.info(
      { sportEventIds: [...tiersByEvent.keys()], tierCounts: [...tiersByEvent.values()].map((tiers) => tiers.length) },
      'Created default tiers',
    );
    return tiersByEvent;
  }

  async getEffectiveTiersForSportEvent(sportEventId: string): Promise<SportEventTierGroup[]> {
    return (await this.getEffectiveTiersAndValuations(sportEventId)).tiers;
  }

  async getEffectiveValuationsForSportEvent(sportEventId: string): Promise<ParticipantValuationView[]> {
    return (await this.getEffectiveTiersAndValuations(sportEventId)).valuations;
  }

  /**
   * Both effective views from one read of the tiers, the valuations and the field (#1196). A
   * caller that already holds the event's field passes it in, and it is not read again.
   */
  async getEffectiveTiersAndValuations(
    sportEventId: string,
    field?: readonly SportEventParticipant[],
  ): Promise<{ tiers: SportEventTierGroup[]; valuations: ParticipantValuationView[] }> {
    const [tiers, valuations, fieldRows] = await Promise.all([
      this.deps.tiers.findBySportEvent(sportEventId),
      this.deps.valuations.findBySportEvent(sportEventId),
      field ?? this.deps.field.findBySportEvent(sportEventId),
    ]);
    const participantIdByEntry = new Map(fieldRows.map((entry) => [entry.id, entry.participantId]));
    const tierById = new Map(tiers.map((tier) => [tier.id, tier]));
    return {
      tiers: tierGroups(tiers, valuations, participantIdByEntry),
      valuations: valuations.map((valuation) => {
        const tier = valuation.sportEventTierId ? tierById.get(valuation.sportEventTierId) : undefined;
        return {
          sportEventParticipantId: valuation.sportEventParticipantId,
          participantId: participantIdByEntry.get(valuation.sportEventParticipantId) as string,
          tierId: tier?.id ?? null,
          tierKey: tier?.tierKey ?? null,
          tierLabel: tier?.label ?? null,
          tierNumber: tier?.tierNumber ?? null,
          tierOrderIndex: valuation.tierOrderIndex,
          price: valuation.price,
        };
      }),
    };
  }

  /**
   * Each event's effective tiers from one read of the events' tiers, valuations and fields
   * (#1201), keyed by event; an event with no tiers has an empty list.
   */
  async getEffectiveTiersForSportEvents(sportEventIds: readonly string[]): Promise<Map<string, SportEventTierGroup[]>> {
    const [tiers, valuations, fieldRows] = await Promise.all([
      this.deps.tiers.findBySportEvents(sportEventIds),
      this.deps.valuations.findBySportEvents(sportEventIds),
      this.deps.field.findBySportEvents(sportEventIds),
    ]);
    const participantIdByEntry = new Map(fieldRows.map((entry) => [entry.id, entry.participantId]));
    return new Map(sportEventIds.map((sportEventId) => [
      sportEventId,
      tierGroups(tiers.filter((tier) => tier.sportEventId === sportEventId), valuations, participantIdByEntry),
    ]));
  }

  /**
   * Puts the active field in its one order (#1807, `orderField`: odds, then seed, then rank,
   * decided for the whole field, then name), then fills the tiers in tier order. With a `tierSize`,
   * each tier takes that many and the last tier takes everyone left. With none, an event that
   * keeps its sport's default tier count gets the sport's designed layout (golf's six tiers of
   * ten, horse racing's three, three and the rest) while that layout reaches every tier; any
   * other tier count, or a field too small for the layout, gets the field spread evenly, larger
   * tiers first (22 drivers on four tiers is 6/6/5/5, 6 horses on three is 2/2/2), so no tier is
   * left empty unless the field is smaller than the tier count. Recomputed from the current tiers and
   * field every run — nothing persisted to drift (plans/124 §4.5a).
   */
  async autoAssignTiers(input: { sportEventId: string; tierSize?: number }): Promise<SportEventTierGroup[]> {
    const event = await this.requireEditableEvent(input.sportEventId);
    const tiers = await this.deps.tiers.findBySportEvent(input.sportEventId);
    if (tiers.length === 0) {
      this.deps.logger?.warn({ sportEventId: input.sportEventId }, 'Cannot auto-assign tiers — the event has no tiers yet');
      return [];
    }
    const { ordered, source } = await this.orderedActiveField(input.sportEventId);
    await this.deps.valuations.assignTiers(tierPlacements(event, tiers, ordered, source, input.tierSize));
    this.deps.logger?.info(
      { sportEventId: input.sportEventId, source, tierSize: input.tierSize ?? null, tierCount: tiers.length, assignedCount: ordered.length },
      'Auto-assigned tiers',
    );
    return this.getEffectiveTiersForSportEvent(input.sportEventId);
  }

  /**
   * Replaces the tier definitions. A change that would strand valuations on a removed tier
   * is refused (409) unless `reassignOrphansTo` names a tier in the new list.
   */
  async replaceTiers(input: {
    sportEventId: string;
    tiers: readonly SportEventTierDefinition[];
    reassignOrphansTo?: string;
  }): Promise<SportEventTierGroup[]> {
    await this.requireEditableEvent(input.sportEventId);
    const newKeys = new Set(input.tiers.map((tier) => tier.tierKey));
    if (input.reassignOrphansTo && !newKeys.has(input.reassignOrphansTo)) {
      throw new SportEventError(
        `reassignOrphansTo tier "${input.reassignOrphansTo}" is not present in the new tier list.`,
        'REASSIGN_TARGET_TIER_NOT_FOUND',
        422,
      );
    }
    const [existing, counts] = await Promise.all([
      this.deps.tiers.findBySportEvent(input.sportEventId),
      this.deps.tiers.countValuations(input.sportEventId),
    ]);
    const removed = existing.filter((tier) => !newKeys.has(tier.tierKey));
    const orphaned = removed.reduce((sum, tier) => sum + (counts.get(tier.id) ?? 0), 0);
    if (orphaned > 0 && !input.reassignOrphansTo) {
      throw new SportEventError(
        `Removing tier(s) ${removed.map((tier) => tier.tierKey).join(', ')} would orphan ${orphaned} assignment(s). Supply reassignOrphansTo to reassign them first.`,
        'TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS',
        409,
      );
    }

    await this.deps.tiers.replace(input.sportEventId, input.tiers, input.reassignOrphansTo);

    this.deps.logger?.info(
      { sportEventId: input.sportEventId, tierCount: input.tiers.length, removedTierCount: removed.length, reassignedCount: orphaned },
      'Replaced tier definitions',
    );
    return this.getEffectiveTiersForSportEvent(input.sportEventId);
  }

  /**
   * The drag-and-drop save: the full desired placement, applied all or none so a dropped
   * request never leaves a half-moved field. Always MANUAL.
   */
  async replaceTierAssignments(input: {
    sportEventId: string;
    assignments: ReadonlyArray<{ sportEventParticipantId: string; tierKey: string; tierOrderIndex: number }>;
  }): Promise<SportEventTierGroup[]> {
    await this.requireEditableEvent(input.sportEventId);
    const [tiers, field] = await Promise.all([
      this.deps.tiers.findBySportEvent(input.sportEventId),
      this.deps.field.findBySportEvent(input.sportEventId),
    ]);
    const tierIdByKey = new Map(tiers.map((tier) => [tier.tierKey, tier.id]));
    const unknownKeys = [...new Set(input.assignments.map((assignment) => assignment.tierKey))].filter((key) => !tierIdByKey.has(key));
    if (unknownKeys.length > 0) {
      throw new SportEventError(`Unknown tier key(s): ${unknownKeys.join(', ')}.`, 'UNKNOWN_TIER_KEY', 422);
    }
    const onField = new Set(field.map((entry) => entry.id));
    const notOnField = input.assignments.map((assignment) => assignment.sportEventParticipantId).filter((id) => !onField.has(id));
    if (notOnField.length > 0) {
      throw new SportEventError(
        `Not on sport event ${input.sportEventId}'s field: ${notOnField.join(', ')}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }

    await this.deps.valuations.assignTiers(input.assignments.map((assignment) => ({
      sportEventParticipantId: assignment.sportEventParticipantId,
      sportEventTierId: tierIdByKey.get(assignment.tierKey) as string,
      tierOrderIndex: assignment.tierOrderIndex,
      source: ValuationSource.MANUAL,
    })));

    this.deps.logger?.info(
      { sportEventId: input.sportEventId, assignedCount: input.assignments.length },
      'Replaced tier assignments',
    );
    return this.getEffectiveTiersForSportEvent(input.sportEventId);
  }

  /**
   * Prices the active field on the budget curve (#93) with `pricingConfig`'s values, in the field's
   * one order, the same auto-assigned tiers use (#1807), and records those values on the event, in
   * one write. A separate, later action from seeding (plans/124
   * §4.7a), repeatable with other values until release. Tiers are untouched. 422
   * PRICING_CONFIG_INVALID when the values contradict each other.
   */
  async autoAssignPrices(input: { sportEventId: string; pricingConfig: EventPricingConfig }): Promise<ParticipantValuationView[]> {
    const { sportEventId, pricingConfig } = input;
    await this.requireEditableEvent(sportEventId);
    const problem = findBudgetPricingProblem(pricingConfig);
    if (problem) {
      throw new SportEventError(problem, 'PRICING_CONFIG_INVALID', 422);
    }
    const { ordered, source } = await this.orderedActiveField(sportEventId);
    if (ordered.length === 0) {
      this.deps.logger?.warn({ sportEventId }, 'Cannot auto-assign prices — the event has no active field participants');
      return [];
    }
    const assignments = pricePlacements(ordered, source, pricingConfig);
    await this.deps.valuations.assignEventPrices({ sportEventId, pricingConfig, assignments });

    this.deps.logger?.info(
      { sportEventId, source, profileName: pricingConfig.profileName, salaryCap: pricingConfig.salaryCap, pricedCount: assignments.length },
      'Auto-assigned prices',
    );
    return this.getEffectiveValuationsForSportEvent(sportEventId);
  }

  /**
   * Tiers and prices the field a provider sync just wrote (#1822), the way the two auto-assign
   * buttons would: in the field's one order (#1807), on the event's own tiers (the sport league's
   * tier count, made with the event), priced with the values the event was last priced with, or
   * else `defaultPricing`, the first Budget pricing profile.
   *
   * An admin's correction is kept: once any field row's tier was placed by hand (MANUAL, the
   * drag-and-drop save), the sync leaves every tier alone, and once any price was typed by hand
   * (the field grid), every price. Pressing an auto-assign button is not a correction: the next
   * sync re-makes from the newer field, with the values that button used. A participant the
   * field gains after a correction stays untiered or unpriced until an admin places them.
   *
   * Released events are locked (#431) and left alone. Nothing is written when the stored tiers
   * or prices already match, so a sync of an unchanged field writes nothing.
   */
  async valueSyncedField(event: SportEvent, defaultPricing: EventPricingConfig): Promise<SyncedFieldValuation> {
    if (event.status !== SportEventStatus.DRAFT) {
      return { outcome: 'SKIPPED', reason: 'LOCKED' };
    }
    const [{ ordered, source, basis }, tiers, valuations] = await Promise.all([
      this.orderedActiveField(event.id),
      this.deps.tiers.findBySportEvent(event.id),
      this.deps.valuations.findBySportEvent(event.id),
    ]);
    if (ordered.length === 0) {
      return { outcome: 'SKIPPED', reason: 'NO_FIELD' };
    }
    const stored = new Map(valuations.map((valuation) => [valuation.sportEventParticipantId, valuation]));

    let tiersResult: SyncedTiers;
    if (valuations.some((valuation) => valuation.tierAssignedSource === ValuationSource.MANUAL)) {
      tiersResult = { result: 'KEPT_AS_EDITED' };
    } else if (tiers.length === 0) {
      tiersResult = { result: 'NO_TIERS' };
    } else {
      const placements = tierPlacements(event, tiers, ordered, source);
      const unchanged = placements.every((placement) => {
        const current = stored.get(placement.sportEventParticipantId);
        return current?.sportEventTierId === placement.sportEventTierId
          && current.tierOrderIndex === placement.tierOrderIndex
          && current.tierAssignedSource === placement.source;
      });
      if (!unchanged) await this.deps.valuations.assignTiers(placements);
      tiersResult = { result: unchanged ? 'UNCHANGED' : 'MADE', basis, tierCount: tiers.length };
    }

    let pricesResult: SyncedPrices;
    if (valuations.some((valuation) => valuation.priceAssignedSource === ValuationSource.MANUAL)) {
      pricesResult = { result: 'KEPT_AS_EDITED' };
    } else {
      const pricingConfig = event.pricingConfig ?? defaultPricing;
      const problem = findBudgetPricingProblem(pricingConfig);
      if (problem) {
        throw new SportEventError(problem, 'PRICING_CONFIG_INVALID', 422);
      }
      const assignments = pricePlacements(ordered, source, pricingConfig);
      const unchanged = event.pricingConfig !== undefined && assignments.every((assignment) => {
        const current = stored.get(assignment.sportEventParticipantId);
        return current?.price === assignment.price && current.priceAssignedSource === assignment.source;
      });
      if (!unchanged) await this.deps.valuations.assignEventPrices({ sportEventId: event.id, pricingConfig, assignments });
      pricesResult = { result: unchanged ? 'UNCHANGED' : 'MADE', basis, pricedCount: assignments.length, profileName: pricingConfig.profileName };
    }

    this.deps.logger?.info(
      { sportEventId: event.id, basis, tiers: tiersResult, prices: pricesResult, fieldSize: ordered.length },
      'Tiered and priced a synced field',
    );
    return { outcome: 'VALUED', sportEventId: event.id, tiers: tiersResult, prices: pricesResult };
  }

  /**
   * The event's active field in its one order (#1807), the order tiers and prices are both filled
   * in, and the source the value that decided it records.
   */
  private async orderedActiveField(sportEventId: string): Promise<{ ordered: SportEventParticipant[]; source: ValuationSource; basis: FieldOrderBasis }> {
    const active = (await this.deps.field.findBySportEvent(sportEventId))
      .filter((entry) => entry.isActive)
      // A full tie keeps this order, so the result never depends on how the rows were read.
      .sort((left, right) => left.participantId.localeCompare(right.participantId));
    const nameOf = new Map((active.length === 0 ? [] : await this.deps.participants.findByIds(active.map((entry) => entry.participantId)))
      .map((participant) => [participant.id, participant.name]));
    const { ordered, decision } = orderField(active.map((entry) => ({
      entry,
      oddsToWin: entry.oddsToWin,
      seedNumber: entry.seedNumber,
      ranking: entry.ranking,
      // Every field row names a participant (a foreign key), so a missing name only ties.
      name: nameOf.get(entry.participantId) ?? '',
    })));
    return { ordered: ordered.map((row) => row.entry), source: SOURCE_BY_BASIS[decision.basis], basis: decision.basis };
  }

  /** 404 EVENT_NOT_FOUND for an unknown event; 409 SPORT_EVENT_TIERS_LOCKED once it is released. */
  private async requireEditableEvent(sportEventId: string): Promise<SportEvent> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event) {
      throw new SportEventError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    try {
      assertTiersAndPricesEditable(event);
    } catch (error) {
      this.deps.logger?.warn({ sportEventId, status: event.status }, 'Refused a tier or price change on a released sport event');
      throw error;
    }
    return event;
  }
}

/** What an automatic tier or price records, by the value that decided the field's order (#1807). */
const SOURCE_BY_BASIS: Record<FieldOrderBasis, ValuationSource> = {
  [FieldOrderBasis.ODDS]: ValuationSource.AUTO_ODDS,
  [FieldOrderBasis.SEED]: ValuationSource.AUTO_SEED,
  [FieldOrderBasis.RANKING]: ValuationSource.AUTO_RANKING,
  [FieldOrderBasis.NAME]: ValuationSource.AUTO_NAME,
};

/**
 * Each ordered field row's tier: with a `tierSize`, each tier takes that many and the last tier
 * the rest; with none, the sport's designed layout while the event keeps the sport's tier count
 * and the layout reaches every tier, else an even spread (see `autoAssignTiers`).
 */
function tierPlacements(
  event: SportEvent,
  tiers: readonly SportEventTier[],
  ordered: readonly SportEventParticipant[],
  source: ValuationSource,
  requestedTierSize?: number,
): Array<{ sportEventParticipantId: string; sportEventTierId: string; tierOrderIndex: number; source: ValuationSource }> {
  const layout = eventSportDefinition(event).defaultTierLayout;
  const fitsLayout = tiers.length === layout.tierCount && ordered.length > (tiers.length - 1) * layout.tierSize;
  const tierSize = requestedTierSize ?? (fitsLayout ? layout.tierSize : undefined);
  const tierIndexAt = tierSize === undefined
    ? evenSpreadTierIndex(ordered.length, tiers.length)
    : (index: number) => Math.min(Math.floor(index / tierSize), tiers.length - 1);
  return ordered.map((entry, index) => ({
    sportEventParticipantId: entry.id,
    sportEventTierId: tiers[tierIndexAt(index)].id,
    tierOrderIndex: index + 1,
    source,
  }));
}

/** Each ordered field row's price on the budget curve (#93). */
function pricePlacements(
  ordered: readonly SportEventParticipant[],
  source: ValuationSource,
  pricingConfig: EventPricingConfig,
): Array<{ sportEventParticipantId: string; price: number; source: ValuationSource }> {
  return deriveGolfPrices(ordered.map((entry) => ({ participantId: entry.id })), pricingConfig)
    .map((entry) => ({ sportEventParticipantId: entry.participantId, price: entry.price, source }));
}

/**
 * The tier index of the participant at `index` when `fieldSize` participants are spread evenly
 * over `tierCount` tiers in order, the first `fieldSize % tierCount` tiers taking one more.
 */
function evenSpreadTierIndex(fieldSize: number, tierCount: number): (index: number) => number {
  const smallSize = Math.floor(fieldSize / tierCount);
  const largeTierCount = fieldSize % tierCount;
  const inLargeTiers = largeTierCount * (smallSize + 1);
  return (index) => (index < inLargeTiers
    ? Math.floor(index / (smallSize + 1))
    : largeTierCount + Math.floor((index - inLargeTiers) / smallSize));
}

/** The tiers with the field rows placed in each, in tier order; a valuation in no tier given is left out. */
function tierGroups(
  tiers: readonly SportEventTier[],
  valuations: readonly SportEventParticipantValuation[],
  participantIdByEntry: ReadonlyMap<string, string>,
): SportEventTierGroup[] {
  return tiers.map((tier) => ({
    ...tier,
    participants: valuations
      .filter((valuation) => valuation.sportEventTierId === tier.id)
      .sort((left, right) => (left.tierOrderIndex ?? Number.MAX_SAFE_INTEGER) - (right.tierOrderIndex ?? Number.MAX_SAFE_INTEGER))
      .map((valuation) => ({
        sportEventParticipantId: valuation.sportEventParticipantId,
        participantId: participantIdByEntry.get(valuation.sportEventParticipantId) as string,
        tierOrderIndex: valuation.tierOrderIndex,
        price: valuation.price,
      })),
  }));
}
