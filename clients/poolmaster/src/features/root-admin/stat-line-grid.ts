import { SPORT_STAT_VALUE_MAX, sportStatValueMin, type SportComposite, type SportStat, type StatLine } from '@poolmaster/shared/domain';
import type { GameStatLineUploadRequest, SportEventParticipantDto } from '@/lib/api';

/** One player's row in a game's stat grid: their stored line for the game, empty when they have none. */
export interface StatLineGridRow {
  sportEventParticipantId: string;
  participantId: string;
  playerName: string;
  team: string | null;
  line: StatLine;
}

/** A row's unsaved inputs, by stat, as typed. */
export type StatLineDraft = Partial<Record<SportStat, string>>;

/** The field's rows for one game, in field order. */
export function statLineGridRows(field: readonly SportEventParticipantDto[], roundNumber: number): StatLineGridRow[] {
  return field.map((entry) => {
    const round = entry.rounds.find((candidate) => candidate.roundNumber === roundNumber);
    return {
      sportEventParticipantId: entry.id,
      participantId: entry.participantId,
      playerName: entry.participant.name,
      team: entry.participant.teamAffiliation ?? null,
      line: Object.fromEntries((round?.statLines ?? []).map((statLine) => [statLine.stat, statLine.value])),
    };
  });
}

/** Whether a typed value is one a stat line stores for the stat: blank, or a whole number from its lowest (0, or below for yards) to 9999. */
export function isStatInput(raw: string, stat: SportStat): boolean {
  const trimmed = raw.trim();
  return trimmed === ''
    || (/^-?\d+$/.test(trimmed) && Number(trimmed) >= sportStatValueMin(stat) && Number(trimmed) <= SPORT_STAT_VALUE_MAX);
}

/** What one stat's input shows: the draft as typed, else the stored value, blank when none is stored. */
export function statInputValue(row: StatLineGridRow, draft: StatLineDraft | undefined, stat: SportStat): string {
  return draft?.[stat] ?? (row.line[stat] === undefined ? '' : String(row.line[stat]));
}

/** The line the row's inputs make, blank stats left out. Undefined while any input is invalid. */
export function draftLine(row: StatLineGridRow, draft: StatLineDraft | undefined, composite: SportComposite): StatLine | undefined {
  const line: Partial<Record<SportStat, number>> = {};
  for (const stat of composite.stats) {
    const raw = statInputValue(row, draft, stat);
    if (!isStatInput(raw, stat)) return undefined;
    if (raw.trim() !== '') line[stat] = Number(raw.trim());
  }
  return line;
}

/**
 * The row to send for a save: the player's whole line for the game, which replaces what is
 * stored, so blank stats are left out and an all-blank row clears the line. Null when the inputs
 * are invalid or make the line already stored.
 */
export function buildStatLineRow(
  row: StatLineGridRow,
  draft: StatLineDraft | undefined,
  composite: SportComposite,
): GameStatLineUploadRequest['rows'][number] | null {
  const line = draftLine(row, draft, composite);
  if (line === undefined) return null;
  const unchanged = composite.stats.every((stat) => line[stat] === row.line[stat]);
  if (unchanged) return null;
  return {
    participantId: row.participantId,
    stats: composite.stats.flatMap((stat) => {
      const value = line[stat];
      return value === undefined ? [] : [{ stat, value }];
    }),
  };
}
