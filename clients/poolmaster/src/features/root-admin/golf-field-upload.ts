import { z } from 'zod';
import {
  parseDelimitedRecords,
  type BulkUploadFormat,
} from '@/features/shared/ui/bulk-upload-parse';
import type {
  SportEventParticipantDto,
  SportEventParticipantUploadPreviewResponse,
  SportEventParticipantUploadRequest,
} from '@/lib/api';
import { GOLF_FIELD_INACTIVE_REASONS } from './golf-field-patch';

/**
 * #129 — the Field editor's bulk upload: rankings, odds, seeds and withdrawals for golfers
 * already on the tournament's field. The server resolves each row against the field and
 * never adds a golfer, so the template is pre-filled with the field as it stands.
 *
 * Omitted means "leave alone" and null means "clear". A blank CSV cell is omitted; the
 * word `null` in a cell clears that value. JSON rows say either directly.
 */

export type GolfFieldUploadRow = SportEventParticipantUploadRequest['rows'][number];
export type GolfFieldUploadPreviewRow = SportEventParticipantUploadPreviewResponse['rows'][number];
export type GolfFieldUploadValues = NonNullable<GolfFieldUploadPreviewRow['after']>;

export const GOLF_FIELD_UPLOAD_HEADERS = [
  'externalId',
  'playerName',
  'ranking',
  'oddsToWin',
  'seedNumber',
  'isActive',
  'inactiveReason',
] as const;

const CLEAR = 'null';

function isClear(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.trim().toLowerCase() === CLEAR);
}

/** A nullable value cell: `null` (or the word) clears it, anything else must parse. */
function clearable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (isClear(value) ? null : value), schema.nullable()).optional();
}

const BOOLEAN_WORDS: Record<string, boolean> = {
  true: true,
  yes: true,
  '1': true,
  false: false,
  no: false,
  '0': false,
};

const golfFieldUploadRowSchema = z
  .object({
    participantId: z.string().trim().min(1).optional(),
    externalId: z.string().trim().min(1).optional(),
    playerName: z.string().trim().min(1).optional(),
    ranking: clearable(z.coerce.number().int().positive()),
    oddsToWin: clearable(z.coerce.number().positive()),
    seedNumber: clearable(z.coerce.number().int().positive()),
    isActive: z
      .preprocess(
        (value) => (typeof value === 'string' ? BOOLEAN_WORDS[value.trim().toLowerCase()] ?? value : value),
        z.boolean({ invalid_type_error: 'isActive must be true or false' }),
      )
      .optional(),
    inactiveReason: clearable(
      z
        .string()
        .trim()
        .transform((value) => value.toUpperCase())
        .pipe(z.enum([GOLF_FIELD_INACTIVE_REASONS[0], ...GOLF_FIELD_INACTIVE_REASONS.slice(1)])),
    ),
  })
  .refine(
    (row) =>
      Boolean(row.participantId) ||
      Boolean(row.externalId) ||
      Boolean(row.playerName),
    { message: 'each row needs a participantId, externalId, or playerName' },
  );

/**
 * Parse pasted / uploaded field text into `previewEventParticipantUpload` request rows.
 * Throws an `Error` with a user-facing message on malformed input; the panel shows it.
 */
export function parseGolfFieldUpload(
  text: string,
  format: BulkUploadFormat,
): GolfFieldUploadRow[] {
  const records = parseDelimitedRecords(text, format);
  if (records.length === 0) {
    throw new Error('No rows found.');
  }
  return records.map((record, index) => {
    const parsed = golfFieldUploadRowSchema.safeParse(record);
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      const field = issue?.path?.[0];
      throw new Error(
        `Row ${index + 1}${field ? ` (${String(field)})` : ''}: ${
          issue?.message ?? 'is not a valid field row'
        }.`,
      );
    }
    // Keep only what the row names: an omitted value must stay omitted, not become undefined-as-null.
    const row: GolfFieldUploadRow = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        (row as Record<string, unknown>)[key] = value;
      }
    }
    return row;
  });
}

/** One template row per golfer on the field, carrying the values stored now. */
export function golfFieldUploadTemplateRows(
  entries: readonly SportEventParticipantDto[],
): Array<Array<string | number>> {
  return entries.map((entry) => [
    entry.participant.externalId ?? '',
    entry.participant.name,
    entry.ranking ?? '',
    entry.oddsToWin ?? '',
    entry.seedNumber ?? '',
    String(entry.isActive),
    entry.inactiveReason ?? '',
  ]);
}

/** A row's values as the preview table shows them, e.g. "#4 · 12.5 · seed 3 · Withdrawn". */
export function formatGolfFieldUploadValues(values: GolfFieldUploadValues | null): string {
  if (!values) {
    return '—';
  }
  const parts = [
    values.ranking !== null ? `#${values.ranking}` : 'unranked',
    values.oddsToWin !== null ? `odds ${values.oddsToWin}` : 'no odds',
    values.seedNumber !== null ? `seed ${values.seedNumber}` : 'unseeded',
  ];
  if (!values.isActive) {
    parts.push(values.inactiveReason ? formatInactiveReason(values.inactiveReason) : 'Inactive');
  }
  return parts.join(' · ');
}

function formatInactiveReason(reason: string): string {
  return reason.charAt(0) + reason.slice(1).toLowerCase();
}

/** Rows Apply would refuse: not matched to exactly one golfer on the field, or a duplicate. */
export function golfFieldUploadBlockedCount(rows: readonly GolfFieldUploadPreviewRow[]): number {
  return rows.filter((row) => row.resolution !== 'MATCHED' || row.rowError !== null).length;
}
