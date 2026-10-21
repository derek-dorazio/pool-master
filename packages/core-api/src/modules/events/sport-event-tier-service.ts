/**
 * SportEventTierService — an event's pick tiers and each field row's valuation: its tier
 * placement and its price (plans/124 §4.5/§4.7a). Cross-sport: tiers and prices are pool
 * mechanics, not golf (#203 stage 2, decision 3).
 *
 * Tiers and prices are event-level only, never a per-contest override (plans/124 §4.6).
 * `getEffectiveTiersForSportEvent` / `getEffectiveValuationsForSportEvent` are the one
 * path every contest-side reader (selections, contest configuration, the entry email) takes.
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
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
  SportEventRepository,
  SportEventTierDefinition,
  SportEventTierRepository,
} from '@poolmaster/shared/db';
import {
  findBudgetPricingProblem,
  getSportDefinition,
  SportEventStatus,
  TierSource,
  ValuationSource,
  type EventPricingConfig,
  type Sport,
  type SportEvent,
  type SportEventParticipant,
  type SportEventTier,
} from '@poolmaster/shared/domain';
import { compareNullsLast, deriveGolfPrices } from '../golf/golf-seeding-algorithm';
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
  logger?: FastifyBaseLogger;
}

export class SportEventTierService {
  constructor(private readonly deps: SportEventTierServiceDeps) {}

  listTiers(sportEventId: string): Promise<SportEventTier[]> {
    return this.deps.tiers.findBySportEvent(sportEventId);
  }

  /**
   * The default tiers for a new event, when it has none: the sport league's tier count where it
   * sets one (the College Football Playoff: six), else the sport's (golf: six). A default, fully
   * editable afterwards; the tier count is however many rows exist, not a stored parameter
   * (plans/124 §4.5a).
   */
  async ensureDefaultTiers(sportEventId: string, sport: Sport, leagueTierCount: number | null): Promise<SportEventTier[]> {
    const existing = await this.deps.tiers.findBySportEvent(sportEventId);
    if (existing.length > 0) {
      return existing;
    }
    const tierCount = leagueTierCount ?? getSportDefinition(sport).defaultTierLayout.tierCount;
    await this.deps.tiers.createMany(sportEventId, Array.from({ length: tierCount }, (_, index) => ({
      tierKey: `tier-${index + 1}`,
      label: `Tier ${index + 1}`,
      tierNumber: index + 1,
    })));
    this.deps.logger?.info({ sportEventId, tierCount }, 'Created default tiers');
    return this.deps.tiers.findBySportEvent(sportEventId);
  }

  async getEffectiveTiersForSportEvent(sportEventId: string): Promise<SportEventTierGroup[]> {
    const [tiers, valuations, field] = await Promise.all([
      this.deps.tiers.findBySportEvent(sportEventId),
      this.deps.valuations.findBySportEvent(sportEventId),
      this.deps.field.findBySportEvent(sportEventId),
    ]);
    const participantIdByEntry = new Map(field.map((entry) => [entry.id, entry.participantId]));
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

  async getEffectiveValuationsForSportEvent(sportEventId: string): Promise<ParticipantValuationView[]> {
    const [tiers, valuations, field] = await Promise.all([
      this.deps.tiers.findBySportEvent(sportEventId),
      this.deps.valuations.findBySportEvent(sportEventId),
      this.deps.field.findBySportEvent(sportEventId),
    ]);
    const tierById = new Map(tiers.map((tier) => [tier.id, tier]));
    const participantIdByEntry = new Map(field.map((entry) => [entry.id, entry.participantId]));
    return valuations.map((valuation) => {
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
    });
  }

  /**
   * Sorts the active field by `source`, then fills the tiers in tier order. With a `tierSize`,
   * each tier takes that many and the last tier takes everyone left. With none, an event that
   * keeps its sport's default tier count gets the sport's designed layout (golf's six tiers of
   * ten, horse racing's three, three and the rest) while that layout reaches every tier; any
   * other tier count, or a field too small for the layout, gets the field spread evenly, larger
   * tiers first (22 drivers on four tiers is 6/6/5/5, 6 horses on three is 2/2/2), so no tier is
   * left empty unless the field is smaller than the tier count. Recomputed from the current tiers and
   * field every run — nothing persisted to drift (plans/124 §4.5a).
   */
  async autoAssignTiers(input: { sportEventId: string; source: TierSource; tierSize?: number }): Promise<SportEventTierGroup[]> {
    const event = await this.requireEditableEvent(input.sportEventId);
    const tiers = await this.deps.tiers.findBySportEvent(input.sportEventId);
    if (tiers.length === 0) {
      this.deps.logger?.warn({ sportEventId: input.sportEventId }, 'Cannot auto-assign tiers — the event has no tiers yet');
      return [];
    }
    const active = (await this.deps.field.findBySportEvent(input.sportEventId)).filter((entry) => entry.isActive);
    const ordered = [...active].sort((left, right) => compareForTiering(left, right, input.source));
    const source = input.source === TierSource.RANKING ? ValuationSource.AUTO_RANKING : ValuationSource.AUTO_ODDS;
    const layout = getSportDefinition(event.sport).defaultTierLayout;
    const fitsLayout = tiers.length === layout.tierCount && ordered.length > (tiers.length - 1) * layout.tierSize;
    const tierSize = input.tierSize ?? (fitsLayout ? layout.tierSize : undefined);
    const tierIndexAt = tierSize === undefined
      ? evenSpreadTierIndex(ordered.length, tiers.length)
      : (index: number) => Math.min(Math.floor(index / tierSize), tiers.length - 1);

    await this.deps.valuations.assignTiers(ordered.map((entry, index) => ({
      sportEventParticipantId: entry.id,
      sportEventTierId: tiers[tierIndexAt(index)].id,
      tierOrderIndex: index + 1,
      source,
    })));

    this.deps.logger?.info(
      {
        sportEventId: input.sportEventId,
        source: input.source,
        tierSize: tierSize ?? null,
        spread: tierSize === undefined ? 'EVEN' : 'FIXED_SIZE',
        tierCount: tiers.length,
        assignedCount: ordered.length,
      },
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
   * Prices the active field on the budget curve (#93) with `pricingConfig`'s values, best seed
   * first, then participants with no seed by odds, shortest first (#653), and
   * records those values on the event, in one write. A separate, later action from seeding (plans/124
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
    const active = (await this.deps.field.findBySportEvent(sportEventId))
      .filter((entry) => entry.isActive)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (active.length === 0) {
      this.deps.logger?.warn({ sportEventId }, 'Cannot auto-assign prices — the event has no active field participants');
      return [];
    }
    const priced = deriveGolfPrices(
      active.map((entry) => ({ participantId: entry.id, seedNumber: entry.seedNumber ?? null, oddsToWin: entry.oddsToWin ?? null, ranking: entry.ranking ?? null })),
      pricingConfig,
    );
    await this.deps.valuations.assignEventPrices({
      sportEventId,
      pricingConfig,
      assignments: priced.map((entry) => ({
        sportEventParticipantId: entry.participantId,
        price: entry.price,
        source: ValuationSource.AUTO_RANKING,
      })),
    });

    this.deps.logger?.info(
      { sportEventId, profileName: pricingConfig.profileName, salaryCap: pricingConfig.salaryCap, pricedCount: priced.length },
      'Auto-assigned prices',
    );
    return this.getEffectiveValuationsForSportEvent(sportEventId);
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

/** Ranking or odds first as `source` says, the other second, then participant id for a stable order. */
function compareForTiering(left: SportEventParticipant, right: SportEventParticipant, source: TierSource): number {
  const byRanking = compareNullsLast(left.ranking, right.ranking);
  const byOdds = compareNullsLast(left.oddsToWin, right.oddsToWin);
  const [first, second] = source === TierSource.RANKING ? [byRanking, byOdds] : [byOdds, byRanking];
  return first || second || left.participantId.localeCompare(right.participantId, undefined, { sensitivity: 'base' });
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
