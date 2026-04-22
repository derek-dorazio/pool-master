import { z } from 'zod';

export const ClientLogLevelSchema = z.enum([
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]);

export const ClientLogEntrySchema = z.object({
  level: ClientLogLevelSchema,
  action: z.string().min(1),
  msg: z.string().min(1).optional(),
  ts: z.string().datetime(),
  route: z.string().min(1).optional(),
  sessionId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  clientRequestId: z.string().uuid().nullable().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  err: z.unknown().optional(),
});

export const ClientLogBatchSchema = z.object({
  schemaVersion: z.literal(1),
  clientTraceId: z.string().min(1),
  webappVersion: z.string().min(1),
  userAgent: z.string().min(1),
  entries: z.array(ClientLogEntrySchema).min(1).max(200),
});

export type ClientLogLevel = z.infer<typeof ClientLogLevelSchema>;
export type ClientLogEntry = z.infer<typeof ClientLogEntrySchema>;
export type ClientLogBatch = z.infer<typeof ClientLogBatchSchema>;
