/**
 * Multi-event contests (#713): the rules for reading a contest's events and an entry's status in
 * each, pure so the server and the web read them one way.
 */
import { ContestEntryStatus, SelectionType } from './enums';
import type { ContestEntry } from './types';

/** The entry's status for one event of its contest; a DRAFT when the entry has no row for it. */
export function contestEntryEventStatus(
  entry: Pick<ContestEntry, 'events'>,
  sportEventId: string,
): ContestEntryStatus {
  return entry.events.find((event) => event.sportEventId === sportEventId)?.status ?? ContestEntryStatus.DRAFT;
}

/** The entry's tiebreaker guess for one event of a prediction contest (#717); null until given. */
export function contestEntryEventTiebreaker(
  entry: Pick<ContestEntry, 'events'>,
  sportEventId: string,
): number | null {
  return entry.events.find((event) => event.sportEventId === sportEventId)?.tiebreakerValue ?? null;
}

/** Whether the entry has submitted at least one event: what makes it count as an entry (#481). */
export function hasSubmittedAnyEvent(entry: Pick<ContestEntry, 'events'>): boolean {
  return entry.events.some((event) => event.status === ContestEntryStatus.SUBMITTED);
}

/**
 * How many events a contest of each selection type may cover: 1 for a type played on one event,
 * null for a type that may cover several. A random draw deals one event's field, a bracket (#721)
 * is one knockout picked to its final, and squares (#711) is played on one game. The server
 * refuses more and the web offers no event change for these, both from this one table.
 */
export const MAX_EVENTS_BY_SELECTION_TYPE = {
  [SelectionType.TIERED]: null,
  [SelectionType.BUDGET_PICK]: null,
  [SelectionType.RANDOM_DRAW]: 1,
  [SelectionType.PICK_EM]: null,
  [SelectionType.BRACKET]: 1,
  [SelectionType.SURVIVOR]: null,
  [SelectionType.SQUARES]: 1,
} as const satisfies Readonly<Record<SelectionType, 1 | null>>;

/** A selection type whose contests cover exactly one event. */
export type OneEventSelectionType = {
  [Type in SelectionType]: (typeof MAX_EVENTS_BY_SELECTION_TYPE)[Type] extends 1 ? Type : never;
}[SelectionType];

/** Whether a contest of this selection type covers exactly one event, so its events never change. */
export function coversOneEvent(selectionType: SelectionType): selectionType is OneEventSelectionType {
  return MAX_EVENTS_BY_SELECTION_TYPE[selectionType] === 1;
}
