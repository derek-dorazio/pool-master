/**
 * The finishing-order operations' contract (#622): an admin's race result for an event of the
 * finish-position family, its dry run and its apply. Like the golf score corrections, every value
 * is entered by the admin and stored exactly as sent; the server derives none of them. What a
 * runner's result is reads back through SportEventParticipantDto's `race` block.
 */
import { z } from 'zod';
import {
  RaceResultChange,
  RaceResultOrderError,
  RaceResultRowError,
  RaceResultStatus,
} from '@poolmaster/shared/domain';
import { registerSchema } from './schema-registry';
import { UploadRowResolutionDtoSchema } from './sport-catalog.dto';

/** The most rows one finishing order holds: a race field is far smaller (8 to 40 runners). */
export const RACE_RESULT_ROWS_MAX = 200;

export const RaceResultRowSchema = z.object({
  participantId: z.string().optional(),
  externalId: z.string().optional(),
  playerName: z.string().optional(),
  resultStatus: z.enum(RaceResultStatus).describe('How the race ended for this runner.'),
  finishPosition: z.number().int().min(1).nullable().describe('Finishing place, 1 for the winner. Runners in a dead heat share a place, and the next place skips (1, 2, 2, 4). Only a FINISHED runner has one; it is required for every FINISHED runner once the result is official.'),
  startPosition: z.number().int().min(1).nullable().describe('Post position (or grid slot); null when not known.'),
  riderName: z.string().trim().min(1).max(255).nullable().describe('The jockey (or rider) for this start; null when not known.'),
}).describe('One runner\'s result. The first identifier present is used: participantId, then externalId, then an exact case-insensitive playerName, matched within the event\'s field. Every value is stored exactly as sent.');
export type RaceResultRow = z.infer<typeof RaceResultRowSchema>;

export const RaceResultUploadRequestSchema = z.object({
  isOfficial: z.boolean().describe('Whether the race\'s result is official once applied. It is set on every result of the race, sent or already stored: a race is official as a whole. Contest scoring counts results only once they are official.'),
  rows: z.array(RaceResultRowSchema).min(1).max(RACE_RESULT_ROWS_MAX),
}).describe('A race\'s finishing order, or a correction to it: one row per runner named. Runners not named keep the result already stored.');
export type RaceResultUploadRequest = z.infer<typeof RaceResultUploadRequestSchema>;

export const RaceResultRowErrorDtoSchema = z.enum(RaceResultRowError).describe('Why a resolved row cannot be applied. DUPLICATE_PARTICIPANT: another row names the same runner. POSITION_WITHOUT_FINISH: a finishing place on a runner that did not finish. FINISH_WITHOUT_POSITION: an official result for a FINISHED runner with no place.');
export type RaceResultRowErrorDto = z.infer<typeof RaceResultRowErrorDtoSchema>;

export const RaceResultOrderErrorDtoSchema = z.enum(RaceResultOrderError).describe('Why the race\'s result as a whole cannot be applied. POSITIONS_INVALID: the finishing places, with the ones already stored for runners not named, do not run 1, 2, 3 ... with only a dead heat repeating a place and skipping the next. FIELD_INCOMPLETE: an official result leaves an active runner on the field with no result, or a FINISHED runner with no place.');
export type RaceResultOrderErrorDto = z.infer<typeof RaceResultOrderErrorDtoSchema>;

export const RaceResultChangeDtoSchema = z.enum(RaceResultChange)
  .describe('What applying the row would do to the runner\'s stored result.');

export const RaceResultValuesDtoSchema = z.object({
  resultStatus: z.enum(RaceResultStatus),
  finishPosition: z.number().int().nullable(),
  startPosition: z.number().int().nullable(),
  riderName: z.string().nullable(),
  isOfficial: z.boolean(),
}).describe('A runner\'s result values.');

export const RaceResultPreviewRowDtoSchema = z.object({
  row: RaceResultRowSchema,
  resolution: UploadRowResolutionDtoSchema,
  sportEventParticipantId: z.uuid().nullable().describe('The field row it resolved to; set only when MATCHED.'),
  participantName: z.string().nullable(),
  rowError: RaceResultRowErrorDtoSchema.nullable(),
  change: RaceResultChangeDtoSchema.nullable().describe('Null when the row cannot be applied: not MATCHED, or a row error.'),
  before: RaceResultValuesDtoSchema.nullable().describe('What is stored now; null when nothing is.'),
  after: RaceResultValuesDtoSchema,
}).describe('What applying one row would do.');
export type RaceResultPreviewRowDto = z.infer<typeof RaceResultPreviewRowDtoSchema>;

export const RaceResultPreviewResponseSchema = z.object({
  rows: z.array(RaceResultPreviewRowDtoSchema).describe('One per row sent, in the order sent.'),
  orderErrors: z.array(RaceResultOrderErrorDtoSchema).describe('Problems with the race\'s result as a whole; empty when it can be applied as far as the order goes.'),
  rollup: z.object({
    total: z.number().int(),
    matched: z.number().int(),
    unresolved: z.number().int(),
    ambiguous: z.number().int(),
    invalid: z.number().int().describe('Resolved rows with a row error.'),
  }).describe('Counts by resolution.'),
}).describe('A dry run of a race result. Nothing is written.');
export type RaceResultPreviewResponse = z.infer<typeof RaceResultPreviewResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('RaceResultUploadRequest', RaceResultUploadRequestSchema);
registerSchema('RaceResultPreviewResponse', RaceResultPreviewResponseSchema);
