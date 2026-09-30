import type {
  ReplaceSportEventTierAssignmentsRequest,
  SportEventParticipantDto,
  SportEventTierDto,
} from '@/lib/api';

export type TierAssignmentPayload =
  ReplaceSportEventTierAssignmentsRequest['assignments'][number];

export const UNASSIGNED_KEY = '__unassigned';

export type TierCard = {
  sportEventParticipantId: string;
  participantId: string;
  name: string;
  /** Null when the golfer has no ranking on record. */
  ranking: number | null;
  /** Null when no odds have been ingested for the golfer. */
  oddsToWin: number | null;
  /** Null until a price is assigned (auto-assign prices, or a manual edit). */
  price: number | null;
};

export type TierColumn = {
  /** The tier's key, or `UNASSIGNED_KEY` for the catch-all column. */
  key: string;
  label: string;
  /** Null for the Unassigned column. */
  tierKey: string | null;
  cards: TierCard[];
};

function cardFor(entry: SportEventParticipantDto): TierCard {
  return {
    sportEventParticipantId: entry.id,
    participantId: entry.participantId,
    name: entry.participant.name,
    ranking: entry.ranking,
    oddsToWin: entry.oddsToWin,
    price: entry.valuation?.price ?? null,
  };
}

/**
 * plans/124 §6.3 — build the tier board from the tier definitions (ordered by
 * tierNumber) plus the field. #236: a golfer's tier and its place in it are on the
 * golfer's valuation (`sportEventTierId`, `tierOrderIndex`); a golfer with no tier,
 * or a tier that is not among the definitions, lands in the Unassigned column.
 */
export function buildTierBoard(
  tiers: readonly SportEventTierDto[],
  field: readonly SportEventParticipantDto[],
): TierColumn[] {
  const tierIds = new Set(tiers.map((tier) => tier.id));
  const byTier = new Map<string, SportEventParticipantDto[]>();
  const unassigned: SportEventParticipantDto[] = [];
  for (const entry of field) {
    const tierId = entry.valuation?.sportEventTierId ?? null;
    if (tierId !== null && tierIds.has(tierId)) {
      byTier.set(tierId, [...(byTier.get(tierId) ?? []), entry]);
    } else {
      unassigned.push(entry);
    }
  }

  const tierColumns: TierColumn[] = [...tiers]
    .sort((a, b) => a.tierNumber - b.tierNumber)
    .map((tier) => {
      const cards = [...(byTier.get(tier.id) ?? [])]
        .sort(
          (a, b) => (a.valuation?.tierOrderIndex ?? 0) - (b.valuation?.tierOrderIndex ?? 0),
        )
        .map(cardFor);
      return { key: tier.tierKey, label: tier.label, tierKey: tier.tierKey, cards };
    });

  return [
    ...tierColumns,
    {
      key: UNASSIGNED_KEY,
      label: 'Unassigned',
      tierKey: null,
      cards: unassigned.map(cardFor),
    },
  ];
}

function locate(
  columns: TierColumn[],
  sportEventParticipantId: string,
): { columnIndex: number; cardIndex: number } | null {
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const cardIndex = columns[columnIndex].cards.findIndex(
      (card) => card.sportEventParticipantId === sportEventParticipantId,
    );
    if (cardIndex !== -1) {
      return { columnIndex, cardIndex };
    }
  }
  return null;
}

/** Move a golfer to the end of `targetColumnKey` (or to a specific index). */
export function moveCard(
  columns: TierColumn[],
  sportEventParticipantId: string,
  targetColumnKey: string,
  targetIndex?: number,
): TierColumn[] {
  const from = locate(columns, sportEventParticipantId);
  const targetColumnIndex = columns.findIndex((c) => c.key === targetColumnKey);
  if (!from || targetColumnIndex === -1) {
    return columns;
  }
  const card = columns[from.columnIndex].cards[from.cardIndex];
  const next = columns.map((column) => ({ ...column, cards: [...column.cards] }));
  next[from.columnIndex].cards.splice(from.cardIndex, 1);
  const insertAt =
    targetIndex === undefined
      ? next[targetColumnIndex].cards.length
      : Math.max(0, Math.min(targetIndex, next[targetColumnIndex].cards.length));
  next[targetColumnIndex].cards.splice(insertAt, 0, card);
  return next;
}

/** Swap a golfer with its neighbour in the same column (up = -1, down = +1). */
export function nudgeCard(
  columns: TierColumn[],
  sportEventParticipantId: string,
  direction: -1 | 1,
): TierColumn[] {
  const from = locate(columns, sportEventParticipantId);
  if (!from) {
    return columns;
  }
  const target = from.cardIndex + direction;
  const column = columns[from.columnIndex];
  if (target < 0 || target >= column.cards.length) {
    return columns;
  }
  const next = columns.map((c, i) =>
    i === from.columnIndex ? { ...c, cards: [...c.cards] } : c,
  );
  const cards = next[from.columnIndex].cards;
  [cards[from.cardIndex], cards[target]] = [cards[target], cards[from.cardIndex]];
  return next;
}

/**
 * Reorder any `{ id }`-keyed list to match `orderedIds` (a `SortableList`
 * `onReorder` result), dropping ids that are no longer present. Shared by the
 * tier board's per-column reorder and the tier-definitions reorder.
 */
export function reorderById<T extends { id: string }>(
  list: readonly T[],
  orderedIds: readonly string[],
): T[] {
  const byId = new Map(list.map((item) => [item.id, item]));
  return orderedIds
    .map((id) => byId.get(id))
    .filter((item): item is T => item !== undefined);
}

/** Apply a `SortableList` reorder result to one column's cards. */
export function reorderColumn(
  columns: TierColumn[],
  columnKey: string,
  orderedIds: readonly string[],
): TierColumn[] {
  return columns.map((column) => {
    if (column.key !== columnKey) {
      return column;
    }
    const byId = new Map(
      column.cards.map((card) => [card.sportEventParticipantId, card]),
    );
    return {
      ...column,
      cards: orderedIds
        .map((id) => byId.get(id))
        .filter((card): card is TierCard => card !== undefined),
    };
  });
}

/** The full desired-state payload for `replaceEventTierAssignments` (assigned golfers only). */
export function toAssignmentsPayload(
  columns: readonly TierColumn[],
): TierAssignmentPayload[] {
  const payload: TierAssignmentPayload[] = [];
  for (const column of columns) {
    if (column.tierKey === null) {
      continue;
    }
    column.cards.forEach((card, index) => {
      payload.push({
        sportEventParticipantId: card.sportEventParticipantId,
        tierKey: column.tierKey as string,
        tierOrderIndex: index,
      });
    });
  }
  return payload;
}

/** Compare two boards' assignment state (tier + order), ignoring price. */
export function assignmentsEqual(
  a: readonly TierColumn[],
  b: readonly TierColumn[],
): boolean {
  const key = (columns: readonly TierColumn[]) =>
    JSON.stringify(
      columns.map((column) => [
        column.key,
        column.cards.map((card) => card.sportEventParticipantId),
      ]),
    );
  return key(a) === key(b);
}
