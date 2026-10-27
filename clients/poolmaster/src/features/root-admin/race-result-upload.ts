import { RaceResultStatus } from '@poolmaster/shared/domain';
import { z } from 'zod';
import type { RaceResultPreviewResponse, RaceResultUploadRequest, SportEventParticipantDto } from '@/lib/api';
import { parseDelimitedRecords, type BulkUploadFormat } from '@/features/shared/ui/bulk-upload-parse';

/**
 * A race's finishing order as an admin pastes or uploads it (#623), parsed into the rows of
 * `previewEventRaceResults` / `applyEventRaceResults`. The server stores every value as sent, so
 * this only reads the text: it never fills in a place or a status the admin did not give, beyond
 * reading a place with no status as a finisher.
 */

export type RaceResultUploadRow = RaceResultUploadRequest['rows'][number];
export type RaceResultPreviewRow = RaceResultPreviewResponse['rows'][number];
export type RaceResultValues = NonNullable<RaceResultPreviewRow['before']>;

export const RACE_RESULT_UPLOAD_HEADERS = [
  'externalId',
  'playerName',
  'finishPosition',
  'resultStatus',
  'startPosition',
  'riderName',
] as const;

/** The status column also takes the short forms a results sheet prints. */
const RESULT_STATUS_ALIASES: Readonly<Record<string, RaceResultStatus>> = {
  DNF: RaceResultStatus.DID_NOT_FINISH,
  DQ: RaceResultStatus.DISQUALIFIED,
  DNS: RaceResultStatus.DID_NOT_START,
};

const optionalCell = z.preprocess(
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- a parsed CSV/JSON cell, genuinely unknown-shaped.
  (value) => (value === undefined || value === null || String(value).trim() === '' ? undefined : value),
  z.unknown(),
);

const positionSchema = z.preprocess(
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- a parsed CSV/JSON cell, genuinely unknown-shaped.
  (value) => (value === undefined || value === null || String(value).trim() === '' ? null : value),
  z.coerce.number().int('must be a whole number').min(1, 'must be 1 or more').nullable(),
);

const resultStatusSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const status = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
    return RESULT_STATUS_ALIASES[status] ?? status;
  },
  z.enum(RaceResultStatus, { error: 'must be FINISHED, DNF, DQ or DNS' }),
);

const uploadRowSchema = z
  .object({
    participantId: optionalCell.pipe(z.string().trim().min(1).optional()),
    externalId: optionalCell.pipe(z.coerce.string().trim().min(1).optional()),
    playerName: optionalCell.pipe(z.string().trim().min(1).optional()),
    finishPosition: positionSchema,
    resultStatus: optionalCell.pipe(resultStatusSchema.optional()),
    startPosition: positionSchema,
    riderName: optionalCell.pipe(z.string().trim().min(1).max(255).optional()),
  })
  .refine((row) => Boolean(row.participantId ?? row.externalId ?? row.playerName), {
    message: 'each row needs a participantId, externalId or playerName',
  });

/** A row with neither a place nor a status says nothing about how the race ended. */
function hasNoResult(record: Record<string, unknown>): boolean {
  return ['finishPosition', 'resultStatus'].every((key) => {
    const value = record[key];
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- a parsed CSV/JSON cell, genuinely unknown-shaped.
    return value === undefined || value === null || String(value).trim() === '';
  });
}

/**
 * Pasted or uploaded finishing-order text as request rows. A row with no place and no status is
 * left out (the template lists every runner, so the admin fills in only those with a result), and
 * a place with no status is a finisher. Throws an `Error` with a message the admin can act on.
 */
export function parseRaceResultUpload(text: string, format: BulkUploadFormat): RaceResultUploadRow[] {
  const records = parseDelimitedRecords(text, format).filter((record) => !hasNoResult(record));
  if (records.length === 0) {
    throw new Error('No row has a finishing place or a result status.');
  }

  return records.map((record, index) => {
    const parsed = uploadRowSchema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues.at(0);
      const field = issue?.path.at(0);
      throw new Error(
        `Row ${index + 1}${field ? ` (${String(field)})` : ''}: ${issue?.message ?? 'is not a valid result row'}.`,
      );
    }
    const { participantId, externalId, playerName, finishPosition, resultStatus, startPosition, riderName } = parsed.data;
    const row: RaceResultUploadRow = {
      resultStatus: resultStatus ?? RaceResultStatus.FINISHED,
      finishPosition,
      startPosition,
      riderName: riderName ?? null,
    };
    if (participantId) row.participantId = participantId;
    if (externalId) row.externalId = externalId;
    if (playerName) row.playerName = playerName;
    return row;
  });
}

/**
 * The template: one row per runner in the field, its place and status blank, and its post
 * position and rider filled in when a result already holds them.
 */
export function raceResultTemplateRows(field: readonly SportEventParticipantDto[]): string[][] {
  return field.map((entry) => [
    entry.participant.externalId ?? '',
    entry.participant.name,
    '',
    '',
    entry.race?.startPosition === null || entry.race?.startPosition === undefined ? '' : String(entry.race.startPosition),
    entry.race?.riderName ?? '',
  ]);
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function formatOrdinal(place: number): string {
  const lastTwo = place % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${place}th`;
  const suffix: Readonly<Record<number, string>> = { 1: 'st', 2: 'nd', 3: 'rd' };
  return `${place}${suffix[place % 10] ?? 'th'}`;
}

/** How the race ended for a runner, in words. */
export const RACE_RESULT_STATUS_LABELS: Readonly<Record<RaceResultStatus, string>> = {
  [RaceResultStatus.FINISHED]: 'Finished',
  [RaceResultStatus.DID_NOT_FINISH]: 'Did not finish',
  [RaceResultStatus.DISQUALIFIED]: 'Disqualified',
  [RaceResultStatus.DID_NOT_START]: 'Did not start',
};

/** One side of a preview row: "1st · start 4 · I. Ortiz Jr." or "Did not finish". */
export function describeRaceResult(values: RaceResultValues | null): string {
  if (!values) return '—';
  const outcome = values.resultStatus === RaceResultStatus.FINISHED && values.finishPosition !== null
    ? formatOrdinal(values.finishPosition)
    : RACE_RESULT_STATUS_LABELS[values.resultStatus];
  return [
    outcome,
    values.startPosition === null ? null : `start ${values.startPosition}`,
    values.riderName,
  ].filter((part) => part !== null).join(' · ');
}
