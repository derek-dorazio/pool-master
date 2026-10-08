/**
 * The draft room's pure domain rules (#324).
 *
 * Every function here is a function of its arguments: no Prisma, no ports, no request, no
 * state. That is deliberate. #323 deleted an `engine/` directory of stateful classes that
 * enforced three rules where the live route enforced ten, and disagreed with it on the
 * central one. The good half of those engines was always the arithmetic — roster size, the
 * status derivation, where a tiered pick lands — and it belongs here, where it can be called
 * and tested without an HTTP request or a database.
 */

import {
  deriveLegacyParticipantStatus,
  DraftStatus,
  SelectionType,
  type Contest,
  type ContestConfiguration,
  type ContestEntry,
  type Participant,
  type SportEventParticipant,
  type SquadMembership,
} from '@poolmaster/shared/domain';
import type { SportEventTierGroup, ParticipantValuationView } from '../events/sport-event-tier-service';
import type {
  DraftTierConfig,
  ParticipantValuation,
  SelectionParticipant,
  TieredPlacement,
} from './types';

/** The two selection types the draft-room surface serves; anything else answers 501. */
export function isRosterSelectionType(selectionType: Contest['selectionType']): boolean {
  return selectionType === SelectionType.TIERED || selectionType === SelectionType.BUDGET_PICK;
}

export function isCommissionerRole(role: unknown): boolean {
  return role === 'COMMISSIONER';
}

/**
 * How many picks a full roster holds. A budget-pick contest carries the number on its
 * configuration; a tiered contest's roster is however many picks its tiers ask for added up
 * (the event's tier count times the contest's picks per tier, #479), which is why a tiered
 * room with no tiers has a roster size of 0 and rejects every submission with
 * `SELECTION_CONFIG_INVALID`.
 */
export function getRosterSize(
  selectionType: Contest['selectionType'],
  configuration: ContestConfiguration | null,
  tiers: readonly DraftTierConfig[],
): number {
  if (selectionType === SelectionType.BUDGET_PICK) return configuration?.rosterSize ?? 0;
  if (selectionType === SelectionType.TIERED) {
    return tiers.reduce((sum, tier) => sum + tier.picksFromTier, 0);
  }
  return 0;
}

/**
 * The contest's lifecycle status as the draft room shows it. A room is COMPLETE once every
 * entry has a full roster even while the contest itself is still OPEN — the roster being
 * full is the thing the room is about.
 */
export function mapContestStatusToDraftStatus(
  contestStatus: Contest['status'],
  isComplete: boolean,
): DraftStatus {
  if (isComplete || contestStatus === 'COMPLETED') return DraftStatus.COMPLETE;
  if (contestStatus === 'DRAFTING' || contestStatus === 'OPEN' || contestStatus === 'ACTIVE') {
    return DraftStatus.LIVE;
  }
  return DraftStatus.PENDING;
}

/**
 * Which user owns each entry, keyed by entry id.
 *
 * An entry belongs to a squad, and a squad's first member by join order is the owner the room
 * attributes it to. An entry whose squad has no active membership maps to the empty string
 * rather than being absent, because the room always shows a `userId` for every entry.
 */
export function buildEntryUserIdMap(
  entries: readonly ContestEntry[],
  squadMemberships: readonly SquadMembership[],
): Map<string, string> {
  const userIdBySquadId = new Map<string, string>();
  for (const membership of squadMemberships) {
    if (!userIdBySquadId.has(membership.squadId)) {
      userIdBySquadId.set(membership.squadId, membership.userId);
    }
  }

  return new Map(entries.map((entry) => [entry.id, userIdBySquadId.get(entry.squadId) ?? '']));
}

/**
 * Tiers are event-owned data (plans/124 §4.6/§4.6b) — this is the one place an already
 * resolved `SportEventTierGroup[]` becomes the draft room's `DraftTierConfig[]`. How many
 * picks each tier takes is the contest's: the same `picksPerTier` for every tier (#479). The legacy
 * tierConfig-JSON branch this replaced is gone; there is exactly one source now. Per-golfer
 * tier and price are a separate lookup (`buildValuationLookup`), since a golfer can have a
 * price with no tier at all.
 */
export function buildDraftTiers(
  tierGroups: readonly SportEventTierGroup[],
  picksPerTier: number,
): DraftTierConfig[] {
  return tierGroups.map((tier) => ({
    tierId: tier.tierKey,
    tierName: tier.label,
    tierNumber: tier.tierNumber,
    picksFromTier: picksPerTier,
    participantIds: tier.participants.map((participant) => participant.participantId),
  }));
}

/**
 * Per-golfer tier and price, keyed by `sportEventParticipantId`. Built from the effective
 * valuations rather than by walking the tier-grouped shape above: a price-only valuation (a
 * budget-format contest with no tier assignment) belongs to no tier and would be invisible to
 * any lookup assembled from tier groups.
 */
export function buildValuationLookup(
  valuations: readonly ParticipantValuationView[],
): Map<string, ParticipantValuation> {
  return new Map(
    valuations.map((valuation) => [
      valuation.sportEventParticipantId,
      {
        tierLabel: valuation.tierLabel,
        tierOrderIndex: valuation.tierOrderIndex,
        price: valuation.price,
      },
    ]),
  );
}

/**
 * The event's field as the draft room's selection lists show it: each row with its
 * participant's identity and its effective tier and price, in tier order then by name.
 *
 * A row is selectable exactly while its field entry is active. The unavailable ones stay in
 * the list with a reason rather than being filtered out, because a draft room has to be able
 * to show why a golfer it used to offer can no longer be picked.
 */
export function buildSelectionParticipants(input: {
  field: readonly SportEventParticipant[];
  participantsById: ReadonlyMap<string, Participant>;
  valuationBySportEventParticipantId: ReadonlyMap<string, ParticipantValuation>;
}): SelectionParticipant[] {
  return input.field
    .map((entry) => {
      const participant = input.participantsById.get(entry.participantId);
      const valuation = input.valuationBySportEventParticipantId.get(entry.id);
      const legacyStatus = deriveLegacyParticipantStatus(entry.isActive, entry.inactiveReason);
      const isAvailable = entry.isActive;

      return {
        sportEventParticipantId: entry.id,
        participantId: entry.participantId,
        participantName: participant?.name ?? '',
        role: participant?.role ?? null,
        teamAffiliation: participant?.teamAffiliation ?? null,
        status: legacyStatus,
        price: valuation?.price ?? undefined,
        ranking: entry.ranking ?? undefined,
        tier: valuation?.tierLabel ?? null,
        orderIndex: valuation?.tierOrderIndex ?? undefined,
        isAvailable,
        unavailableReason: isAvailable
          ? undefined
          : `SportEventParticipant ${entry.id} is unavailable with status ${legacyStatus}`,
      };
    })
    .sort((left, right) => {
      const orderDiff =
        (left.orderIndex ?? Number.MAX_SAFE_INTEGER) - (right.orderIndex ?? Number.MAX_SAFE_INTEGER);
      if (orderDiff !== 0) return orderDiff;
      const nameDiff = left.participantName.localeCompare(right.participantName, undefined, {
        sensitivity: 'base',
      });
      if (nameDiff !== 0) return nameDiff;
      // Field rows that tie on both tier order and name used to fall back to whatever order
      // the read returned. Ordering by id keeps the room's participant list stable instead.
      return left.sportEventParticipantId.localeCompare(right.sportEventParticipantId);
    });
}

/**
 * Where a tiered selection lands within the entry, and which pick it displaces.
 *
 * The central rule, and the one the deleted engines got backwards: **a full tier replaces, it
 * does not reject.** When the entry already holds as many picks from this tier as the tier
 * asks for, the oldest-first list's last pick is displaced and the new one takes its round.
 * `ENTRY_COMPLETE` is for a full entry with no tier to replace within — which is why the
 * replacement check runs first and the completeness check consults its result.
 *
 * A tier configured to contribute no picks is the degenerate case worth naming: every entry
 * already holds "enough" picks from it, but there is no pick to displace, so a full entry
 * answers `entry-complete` and an unfull one simply places.
 */
export function resolveTieredPlacement(input: {
  tier: DraftTierConfig;
  tiers: readonly DraftTierConfig[];
  /** The entry's picks, oldest first, each with the canonical participant it points at. */
  existingPicks: readonly { id: string; participantId: string }[];
  rosterSize: number;
}): TieredPlacement {
  const { tier, tiers, existingPicks, rosterSize } = input;

  const participantIdsInTier = new Set(tier.participantIds);
  const picksInTier = existingPicks.filter((pick) => participantIdsInTier.has(pick.participantId));
  const replacedPickId =
    picksInTier.length >= tier.picksFromTier
      ? picksInTier[picksInTier.length - 1]?.id ?? null
      : null;

  if (existingPicks.length >= rosterSize && !replacedPickId) {
    return { kind: 'entry-complete' };
  }

  const effectivePicksInTierCount = replacedPickId
    ? tier.picksFromTier - 1
    : Math.min(picksInTier.length, tier.picksFromTier - 1);
  const roundsBeforeTier = tiers
    .filter((item) => item.tierNumber < tier.tierNumber)
    .reduce((sum, item) => sum + item.picksFromTier, 0);
  const draftRound = roundsBeforeTier + effectivePicksInTierCount + 1;

  return replacedPickId
    ? { kind: 'replace', draftRound, replacedPickId }
    : { kind: 'place', draftRound };
}

/**
 * The tier a participant's tier label names, by id or by display name. Field rows carry the
 * label rather than the tier's key, and both have matched since tiers moved onto the event,
 * so both are accepted.
 */
export function findTierByLabel(
  tiers: readonly DraftTierConfig[],
  tierLabel: string,
): DraftTierConfig | undefined {
  return tiers.find((tier) => tier.tierId === tierLabel || tier.tierName === tierLabel);
}

/** Which tier each participant sits in, for resolving a pick's tier from its participant. */
export function buildTierByParticipantId(
  tiers: readonly DraftTierConfig[],
): Map<string, DraftTierConfig> {
  const tierByParticipantId = new Map<string, DraftTierConfig>();
  for (const tier of tiers) {
    for (const participantId of tier.participantIds) {
      tierByParticipantId.set(participantId, tier);
    }
  }
  return tierByParticipantId;
}
