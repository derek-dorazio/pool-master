/**
 * The golf score-correction operations' contract (#236). These are the only event
 * operations that keep a golf name, because they write the golf extension rows: an
 * uploaded round of scores, its dry run, and a single-cell correction. What a golfer
 * scored is read back through SportEventParticipantDto's rounds and standing.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { GolfRoundUpdateSchema } from './live-score.dto';
import { UploadRowResolutionDtoSchema } from './sport-catalog.dto';

export const GolfRoundStatusDtoSchema = GolfRoundUpdateSchema.shape.status;
export type GolfRoundStatusDto = z.infer<typeof GolfRoundStatusDtoSchema>;

export const GolfRoundScoreRowSchema = z.object({
  participantId: z.string().optional(),
  externalId: z.string().optional(),
  playerName: z.string().optional(),
  strokes: z.number().int().nullable().describe('Null when only the score to par is known; such a row is not stored.'),
  scoreToPar: z.number().int(),
  thru: z.number().int().min(0).max(18).optional().describe('Holes completed in the round. A round is 18 holes; playoff holes are never scored.'),
  status: GolfRoundStatusDtoSchema,
  completedAt: z.string().datetime().optional(),
}).describe('One golfer\'s result for one round. The first identifier present is used: participantId, then externalId, then an exact case-insensitive playerName, matched within the event\'s field.');
export type GolfRoundScoreRow = z.infer<typeof GolfRoundScoreRowSchema>;

export const GolfRoundScoreUploadRequestSchema = z.object({
  rows: z.array(GolfRoundScoreRowSchema).min(1).max(500),
}).describe('A round of golf scores.');
export type GolfRoundScoreUploadRequest = z.infer<typeof GolfRoundScoreUploadRequestSchema>;

export const GolfRoundScoreChangeDtoSchema = z.enum(['CREATE', 'UPDATE', 'UNCHANGED', 'SKIPPED'])
  .describe('What applying the row would do to the golfer\'s stored round. SKIPPED: the row has no strokes, so applying stores nothing for it.');

export const GolfRoundScoreValuesDtoSchema = z.object({
  strokes: z.number().int().nullable(),
  scoreToPar: z.number().int(),
  thru: z.number().int().nullable(),
  status: z.string(),
}).describe('A golfer\'s round values.');

export const GolfRoundScorePreviewRowDtoSchema = z.object({
  row: GolfRoundScoreRowSchema,
  resolution: UploadRowResolutionDtoSchema,
  sportEventParticipantId: z.string().uuid().nullable().describe('The field row it resolved to; set only when MATCHED.'),
  participantName: z.string().nullable(),
  change: GolfRoundScoreChangeDtoSchema,
  before: GolfRoundScoreValuesDtoSchema.nullable().describe('What is stored now; null when nothing is.'),
  after: GolfRoundScoreValuesDtoSchema,
}).describe('What applying one uploaded row would do.');
export type GolfRoundScorePreviewRowDto = z.infer<typeof GolfRoundScorePreviewRowDtoSchema>;

export const GolfRoundScorePreviewResponseSchema = z.object({
  rows: z.array(GolfRoundScorePreviewRowDtoSchema).describe('One per uploaded row, in upload order.'),
  rollup: z.object({
    total: z.number().int(),
    matched: z.number().int(),
    unresolved: z.number().int(),
    ambiguous: z.number().int(),
  }).describe('Counts by resolution.'),
}).describe('A dry run of a golf score upload. Nothing is written.');
export type GolfRoundScorePreviewResponse = z.infer<typeof GolfRoundScorePreviewResponseSchema>;

export const UpdateGolfRoundScoreRequestSchema = z.object({
  strokes: z.number().int().optional(),
  scoreToPar: z.number().int().optional(),
  thru: z.number().int().min(0).max(18).optional().describe('Holes completed in the round. A round is 18 holes; playoff holes are never scored.'),
  status: GolfRoundStatusDtoSchema.optional(),
  completedAt: z.string().datetime().nullable().optional().describe('Null clears it.'),
}).describe('A correction to one golfer\'s round. Each value sent is stored exactly as sent and nothing is derived from another: to par is not computed from strokes, and completedAt is not set by a COMPLETED status. Omitted values keep what is stored.');
export type UpdateGolfRoundScoreRequest = z.infer<typeof UpdateGolfRoundScoreRequestSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('GolfRoundScoreUploadRequest', GolfRoundScoreUploadRequestSchema);
registerSchema('GolfRoundScorePreviewResponse', GolfRoundScorePreviewResponseSchema);
registerSchema('UpdateGolfRoundScoreRequest', UpdateGolfRoundScoreRequestSchema);
