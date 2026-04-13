import { z } from 'zod';

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().describe('Stable machine-readable error code.'),
    message: z.string().describe('Human-readable error summary safe to show to clients.'),
    details: z.unknown().optional().describe('Optional structured details for client-specific handling or diagnostics.'),
  }).describe('Error payload object.'),
}).describe('Standard API error envelope.');

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const ErrorEnvelopeJsonSchemaName = 'ErrorEnvelope';
