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
  PricingProfileRepository,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
  SportEventRepository,
  SportEventTierDefinition,
  SportEventTierRepository,
  TierAssignment,
  TierProfileRepository,
} from '@poolmaster/shared/db';
import {
  eventPricingOf,
  findBudgetPricingProblem,
  FieldOrderBasis,
  orderField,
  placeInTiers,
  SportEventStatus,
  ValuationSource,
  type EventPricingConfig,
  type EventTierConfig,
  type SportEvent,
  type SportLeague,
  type SportEventParticipant,
  type SportEventParticipantValuation,
  type SportEventTier,
  type PricingProfile,
  type TierProfile,
  type TierSpread,
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
  | { result: 'KEPT_AS_EDITED'; untiered: number }
  | { result: 'NO_TIERS' };

/** What a field sync's pricing did (#1822): made or found already made, or kept as an admin edited them. */
export type SyncedPrices =
  | { result: 'MADE' | 'UNCHANGED'; basis: FieldOrderBasis; pricedCount: number; profileName: string }
  | { result: 'KEPT_AS_EDITED'; unpriced: number };

/** What tiering and pricing a synced field did, or why it did neither. */
export type SyncedFieldValuation =
  | { outcome: 'VALUED'; sportEventId: string; tiers: SyncedTiers; prices: SyncedPrices }
  | { outcome: 'SKIPPED'; reason: 'LOCKED' | 'NO_FIELD' };

/** Whether the event's tiers and prices may still change: only while it is a draft (#431). The one lock rule. */
export function areTiersAndPricesEditable(event: SportEvent): boolean {
  return event.status === SportEventStatus.DRAFT;
}

/**
 * Refuses a tier or price change once the event is released (#431). The field grid's price
 * column goes through this too, so there is one lock rule.
 */
export function assertTiersAndPricesEditable(event: SportEvent): void {
  if (!areTiersAndPricesEditable(event)) {
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
  /** The event's sport league's tier profile (#1844), the layout auto-tiering fills. */
  tierProfiles: Pick<TierProfileRepository, 'findBySportLeague' | 'findById'>;
  /** The event's sport league's pricing profile (#1844), which prices a synced field never priced before. */
  pricingProfiles: Pick<PricingProfileRepository, 'findBySportLeague'>;
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
   * New events' default tiers, every event's in one insert (#1253): its sport league's tier
   * profile's count (#1844: the College Football Playoff's six, golf's six). A default, fully
   * editable afterwards; the tier count is however many rows exist, not a stored parameter
   * (plans/124 §4.5a). The events have no tiers yet: an event is created with them. Answers each
   * event's tiers as written. The caller has the league, so the profile is one read by its id.
   * 404 TIER_PROFILE_NOT_FOUND for a profile that is gone.
   */
  async createDefaultTiers(
    sportLeague: Pick<SportLeague, 'id' | 'tierProfileId'>,
    sportEventIds: readonly string[],
  ): Promise<Map<string, SportEventTierDefinition[]>> {
    if (sportEventIds.length === 0) return new Map();
    const profile = await this.deps.tierProfiles.findById(sportLeague.tierProfileId);
    if (!profile) {
      throw new SportEventError(`Tier profile ${sportLeague.tierProfileId} of sport league ${sportLeague.id} was not found.`, 'TIER_PROFILE_NOT_FOUND', 404);
    }
    const { tierCount } = profile;
    const tiersByEvent = new Map(sportEventIds.map((sportEventId) => [
      sportEventId,
      Array.from({ length: tierCount }, (_, index) => ({
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
   * decided for the whole field, then name), then fills the tiers in tier order by its sport
   * league's tier profile (#1844, `placeInTiers`): each tier but the last takes the profile's size,
   * or the `tierSize` sent, and the last tier takes the rest, or up to its cap, with anyone beyond
   * in no tier. An event whose tier count is not the profile's, or whose field is too small for
   * it, gets the field spread evenly, larger tiers first (22 drivers on four tiers is 6/6/5/5).
   * Recomputed from the current tiers and field every run, and the layout used is recorded on the
   * event with the tiers.
   */
  async autoAssignTiers(input: { sportEventId: string; tierSize?: number }): Promise<SportEventTierGroup[]> {
    const event = await this.requireEditableEvent(input.sportEventId);
    await this.placeFieldInTiers(event, input.tierSize);
    return this.getEffectiveTiersForSportEvent(input.sportEventId);
  }

  /** `autoAssignTiers`' placement, for an event already checked editable. */
  private async placeFieldInTiers(event: SportEvent, tierSize?: number): Promise<void> {
    const tiers = await this.deps.tiers.findBySportEvent(event.id);
    if (tiers.length === 0) {
      this.deps.logger?.warn({ sportEventId: event.id }, 'Cannot auto-assign tiers — the event has no tiers yet');
      return;
    }
    const [{ ordered, source }, profile] = await Promise.all([
      this.orderedActiveField(event.id),
      this.requireTierProfile(event),
    ]);
    const { placements, tierConfig, spread } = tierPlacements(profile, tiers, ordered, source, tierSize);
    await this.deps.valuations.assignEventTiers({ sportEventId: event.id, tierConfig, assignments: placements });
    this.deps.logger?.info(
      {
        sportEventId: event.id,
        source,
        profileName: tierConfig.profileName,
        tierSize: spread === 'EVEN' ? null : tierConfig.tierSize,
        spread,
        tierCount: tiers.length,
        assignedCount: placements.filter((placement) => placement.sportEventTierId !== null).length,
      },
      'Auto-assigned tiers',
    );
  }

  /**
   * Replaces the event's tier definitions, its optional override of the tiers it copied from its
   * sport league's tier profile. While no tier was placed by hand, the field is then placed in
   * the new tiers at once, as Auto-assign tiers would, so anyone in a removed tier simply moves.
   * Once any tier was placed by hand (MANUAL, which freezes automatic tiering for the event), the
   * places are kept, and a change that would strand participants on a removed tier is refused
   * (409) unless `reassignOrphansTo` names a tier in the new list.
   */
  async replaceTiers(input: {
    sportEventId: string;
    tiers: readonly SportEventTierDefinition[];
    reassignOrphansTo?: string;
  }): Promise<SportEventTierGroup[]> {
    const event = await this.requireEditableEvent(input.sportEventId);
    const newKeys = new Set(input.tiers.map((tier) => tier.tierKey));
    if (input.reassignOrphansTo && !newKeys.has(input.reassignOrphansTo)) {
      throw new SportEventError(
        `reassignOrphansTo tier "${input.reassignOrphansTo}" is not present in the new tier list.`,
        'REASSIGN_TARGET_TIER_NOT_FOUND',
        422,
      );
    }
    const [existing, counts, valuations] = await Promise.all([
      this.deps.tiers.findBySportEvent(input.sportEventId),
      this.deps.tiers.countValuations(input.sportEventId),
      this.deps.valuations.findBySportEvent(input.sportEventId),
    ]);
    const placedByHand = valuations.some((valuation) => valuation.tierAssignedSource === ValuationSource.MANUAL);
    const removed = existing.filter((tier) => !newKeys.has(tier.tierKey));
    const orphaned = removed.reduce((sum, tier) => sum + (counts.get(tier.id) ?? 0), 0);
    if (placedByHand && orphaned > 0 && !input.reassignOrphansTo) {
      throw new SportEventError(
        `Removing tier(s) ${removed.map((tier) => tier.tierKey).join(', ')} would orphan ${orphaned} assignment(s). Supply reassignOrphansTo to reassign them first.`,
        'TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS',
        409,
      );
    }

    await this.deps.tiers.replace(input.sportEventId, input.tiers, placedByHand ? input.reassignOrphansTo : undefined);
    this.deps.logger?.info(
      { sportEventId: input.sportEventId, tierCount: input.tiers.length, removedTierCount: removed.length, placedByHand, reassignedCount: placedByHand ? orphaned : 0 },
      'Replaced tier definitions',
    );
    // A second write: should it fail, the new tiers stand with the field partly untiered, which the
    // next Auto-assign tiers or field sync places again.
    if (!placedByHand) await this.placeFieldInTiers(event);

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
   * buttons would: in the field's one order (#1807), on the event's own tiers by its sport league's
   * tier profile (#1844), priced with the values the event was last priced with, or else its sport
   * league's pricing profile.
   *
   * An admin's correction is kept: once any field row's tier was placed by hand (MANUAL, the
   * drag-and-drop save), the sync leaves every tier alone, and once any price was typed by hand
   * (the field grid), every price. Pressing an auto-assign button is not a correction: the next
   * sync re-makes from the newer field, with the pricing values that button used; a tier size sent
   * to that button is not kept (the web app sends none), so the sync lays the tiers out as the
   * button does with no size. A bracket replacement of a withdrawn participant places the
   * replacement by hand (MANUAL), so it counts as a correction too. A participant the field gains
   * after a correction stays untiered or unpriced until an admin places them, and the outcome
   * counts them so the run can say so.
   *
   * Released events are locked (#431) and left alone. Nothing is written when the stored tiers
   * or prices already match, so a sync of an unchanged field writes nothing.
   */
  async valueSyncedField(event: SportEvent): Promise<SyncedFieldValuation> {
    if (!areTiersAndPricesEditable(event)) {
      return { outcome: 'SKIPPED', reason: 'LOCKED' };
    }
    const [tierProfile, pricingConfig] = await Promise.all([
      this.requireTierProfile(event),
      event.pricingConfig ?? this.requirePricingProfile(event).then(eventPricingOf),
    ]);
    // Checked before anything is written, so a bad profile never leaves tiers made and prices not.
    const problem = findBudgetPricingProblem(pricingConfig);
    if (problem) {
      throw new SportEventError(problem, 'PRICING_CONFIG_INVALID', 422);
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
      // A row placed beyond a capped last tier was placed, so only one never placed is waiting.
      tiersResult = { result: 'KEPT_AS_EDITED', untiered: ordered.filter((entry) => !stored.get(entry.id)?.tierAssignedSource).length };
    } else if (tiers.length === 0) {
      tiersResult = { result: 'NO_TIERS' };
    } else {
      const { placements, tierConfig } = tierPlacements(tierProfile, tiers, ordered, source);
      const unchanged = sameTierConfig(event.tierConfig, tierConfig) && placements.every((placement) => {
        const current = stored.get(placement.sportEventParticipantId);
        return (current?.sportEventTierId ?? null) === placement.sportEventTierId
          && current?.tierOrderIndex === placement.tierOrderIndex
          && current.tierAssignedSource === placement.source;
      });
      if (!unchanged) await this.deps.valuations.assignEventTiers({ sportEventId: event.id, tierConfig, assignments: placements });
      tiersResult = { result: unchanged ? 'UNCHANGED' : 'MADE', basis, tierCount: tiers.length };
    }

    let pricesResult: SyncedPrices;
    if (valuations.some((valuation) => valuation.priceAssignedSource === ValuationSource.MANUAL)) {
      pricesResult = { result: 'KEPT_AS_EDITED', unpriced: ordered.filter((entry) => (stored.get(entry.id)?.price ?? null) === null).length };
    } else {
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

  /** The event's sport league's tier profile; every league names one, so a missing one is a broken reference. */
  private async requireTierProfile(event: Pick<SportEvent, 'sportLeagueId'>): Promise<TierProfile> {
    const profile = await this.deps.tierProfiles.findBySportLeague(event.sportLeagueId);
    if (!profile) throw new SportEventError(`Sport league ${event.sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    return profile;
  }

  /** The event's sport league's pricing profile; every league names one. */
  private async requirePricingProfile(event: Pick<SportEvent, 'sportLeagueId'>): Promise<PricingProfile> {
    const profile = await this.deps.pricingProfiles.findBySportLeague(event.sportLeagueId);
    if (!profile) throw new SportEventError(`Sport league ${event.sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    return profile;
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
 * Each ordered field row's tier by the tier profile (`placeInTiers`), or none beyond a capped last
 * tier, and the layout as the event records it.
 */
function tierPlacements(
  profile: TierProfile,
  tiers: readonly SportEventTier[],
  ordered: readonly SportEventParticipant[],
  source: ValuationSource,
  requestedTierSize?: number,
): { placements: TierAssignment[]; tierConfig: EventTierConfig; spread: TierSpread } {
  const { tierIndexes, spread } = placeInTiers(profile, tiers.length, ordered.length, requestedTierSize);
  return {
    placements: ordered.map((entry, index) => {
      const tierIndex = tierIndexes[index];
      return {
        sportEventParticipantId: entry.id,
        sportEventTierId: tierIndex === null ? null : tiers[tierIndex].id,
        tierOrderIndex: index + 1,
        source,
      };
    }),
    tierConfig: {
      profileName: profile.name,
      tierCount: profile.tierCount,
      tierSize: requestedTierSize ?? profile.tierSize,
      lastTier: profile.lastTier,
      lastTierMax: profile.lastTierMax,
    },
    spread,
  };
}

/** Whether the event already records this layout, so a re-run that places the same writes nothing. */
function sameTierConfig(stored: EventTierConfig | undefined, next: EventTierConfig): boolean {
  return stored !== undefined
    && stored.profileName === next.profileName
    && stored.tierCount === next.tierCount
    && stored.tierSize === next.tierSize
    && stored.lastTier === next.lastTier
    && stored.lastTierMax === next.lastTierMax;
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
