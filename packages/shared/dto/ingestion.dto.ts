import { z } from 'zod';
import { DateTimeSchema } from './common.dto';

export const IngestionFeedTypeSchema = z.enum([
  'EVENTSCHEDULE',
  'EVENTPARTICIPANTS',
  'PARTICIPANTRANKINGS',
  'EVENTLIVESCORES',
  'EVENTRESULTS',
]).describe('Explicit ingestion feed type requested by the caller.');
export type IngestionFeedType = z.infer<typeof IngestionFeedTypeSchema>;

export const SportSyncRequestSchema = z.object({
  feeds: z.array(z.enum(['EVENTSCHEDULE', 'PARTICIPANTRANKINGS'])).min(1).describe(
    'Feed types to run for a sport-level sync request. Event participant, live-score, result, and odds hydration are event-scoped and must use the event sync endpoint.',
  ),
  from: DateTimeSchema.optional().describe('Optional lower bound for sport-level event discovery.'),
  to: DateTimeSchema.optional().describe('Optional upper bound for sport-level event discovery.'),
}).describe('Feed-aware sport sync request.');
export type SportSyncRequest = z.infer<typeof SportSyncRequestSchema>;

export const MockEventStateSchema = z.enum(['open', 'locked', 'live', 'completed']).describe(
  'Mock-provider-only event state override for manual QA event syncs.',
);
export type MockEventState = z.infer<typeof MockEventStateSchema>;

export const EventSyncRequestSchema = z.object({
  feeds: z.array(z.enum(['EVENTPARTICIPANTS', 'EVENTLIVESCORES', 'EVENTRESULTS'])).min(1).describe(
    'Feed types to run for a specific event sync request.',
  ),
  mockEventState: MockEventStateSchema.optional().describe(
    'Optional mock-provider-only event state override for manual QA event syncs.',
  ),
}).describe('Feed-aware event sync request.');
export type EventSyncRequest = z.infer<typeof EventSyncRequestSchema>;
