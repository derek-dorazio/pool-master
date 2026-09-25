import { z } from 'zod';
import { registerSchema } from './schema-registry';

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
  // #206 — session and user identity are NOT accepted from the client. The
  // ingest route runs with optional auth, so the server reads them from the
  // verified JWT (`request.authUser`) on the request that carries the batch.
  // A client-supplied identity would let any caller attribute log lines to
  // any session or user.
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

// --- Published contract (#192) -------------------------------------------------
// ClientLogBatch is a request body; the frontend builds it in lib/logger/network-sink.ts.
registerSchema('ClientLogLevel', ClientLogLevelSchema);
registerSchema('ClientLogEntry', ClientLogEntrySchema);
registerSchema('ClientLogBatch', ClientLogBatchSchema);
