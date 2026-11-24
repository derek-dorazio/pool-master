/**
 * Sync finding DTOs (#1999, league model 2): the one list of problems the sync found, and a root
 * admin's actions on each. Root admin only.
 */
import { z } from 'zod';
import {
  ProviderSyncFindingAction,
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  ProviderSyncFindingStatus,
  Sport,
} from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';
import { registerSchema } from './schema-registry';

export const ProviderSyncFindingSeveritySchema = z.enum(ProviderSyncFindingSeverity).describe('ERROR: synced data is wrong or missing until someone acts (it also raises the alarm when it opens). WARNING: something the sync skipped or guessed at. INFO: something it noticed and left alone on purpose.');
export const ProviderSyncFindingStatusSchema = z.enum(ProviderSyncFindingStatus).describe('OPEN until it is RESOLVED (an admin fixed it; a missing webhook secret also resolves once it is set) or WAIVED (an admin accepted it, with a note). A waived finding stays waived when the sync sees it again; a resolved one opens again.');
export const ProviderSyncFindingKindSchema = z.enum(ProviderSyncFindingKind).describe('What it is about. UNMAPPED_PARTICIPANT: the feed sent a participant id no participant of the league is mapped to (providerValue). WEBHOOK_SECRET_MISSING: the Provider\'s webhooks are on but its signing secret is not set here.');
export const ProviderSyncFindingActionSchema = z.enum(ProviderSyncFindingAction).describe('MAP_PARTICIPANT: mapProviderSyncFindingParticipant. RESOLVE, WAIVE (with a note) and REOPEN: changeProviderSyncFindingStatus.');

export const ProviderSyncFindingDtoSchema = z.object({
  id: z.uuid(),
  kind: ProviderSyncFindingKindSchema,
  severity: ProviderSyncFindingSeveritySchema,
  status: ProviderSyncFindingStatusSchema,
  sportLeague: z.object({ id: z.uuid(), name: z.string(), sport: z.enum(Sport) }).describe('The sport league it is about: every finding has one.'),
  sportEvent: z.object({ id: z.uuid(), name: z.string() }).nullable().describe('The event it is about; null when its kind names none.'),
  provider: z.object({ id: z.uuid(), name: z.string() }).nullable().describe('The Provider it is about; null when its kind names none.'),
  providerValue: z.string().nullable().describe('What the feed sent that nothing maps, as the feed sent it (an UNMAPPED_PARTICIPANT\'s participant id); null when its kind has none.'),
  providerValueName: z.string().nullable().describe('The feed\'s own name for that value, when it sent one.'),
  waiveNote: z.string().nullable().describe('Why it was waived; set only while WAIVED.'),
  firstSeenAt: DateTimeSchema.describe('When the sync first raised it.'),
  lastSeenAt: DateTimeSchema.describe('When the sync last raised it.'),
  seenCount: z.number().int().min(1).describe('How many sync passes have raised it.'),
  statusChangedAt: DateTimeSchema.describe('When its status was last set.'),
  statusChangedBy: z.object({
    id: z.uuid(),
    displayName: z.string().describe('Their name, for display.'),
  }).nullable().describe('The root admin who last set its status; null when the sync did, or that account was deleted.'),
  actions: z.array(ProviderSyncFindingActionSchema).describe('What a root admin can do with it now, in the order to offer them. An OPEN finding offers its kind\'s own fix first (MAP_PARTICIPANT), then RESOLVE and WAIVE; a resolved or waived one offers REOPEN.'),
}).describe('One sync finding: a problem the sync found, one per kind and subject.');
export type ProviderSyncFindingDto = z.infer<typeof ProviderSyncFindingDtoSchema>;

export const ProviderSyncFindingListResponseSchema = z.object({
  findings: z.array(ProviderSyncFindingDtoSchema),
}).describe('Every finding kept, most recently seen first. Nothing pages it: a resolved finding is deleted 90 days after it was resolved, and open and waived ones are kept.');
export type ProviderSyncFindingListResponse = z.infer<typeof ProviderSyncFindingListResponseSchema>;

export const ProviderSyncFindingResponseSchema = z.object({
  finding: ProviderSyncFindingDtoSchema,
}).describe('One sync finding.');
export type ProviderSyncFindingResponse = z.infer<typeof ProviderSyncFindingResponseSchema>;

export const ChangeProviderSyncFindingStatusRequestSchema = z.object({
  action: z.enum([ProviderSyncFindingAction.RESOLVE, ProviderSyncFindingAction.WAIVE, ProviderSyncFindingAction.REOPEN]).describe('One of the finding\'s offered actions: RESOLVE, WAIVE or REOPEN.'),
  waiveNote: z.string().max(2000).optional().describe('Why it is waived: required, and not blank, for WAIVE; ignored otherwise.'),
}).describe('A root admin resolving, waiving or reopening a finding.');
export type ChangeProviderSyncFindingStatusRequest = z.infer<typeof ChangeProviderSyncFindingStatusRequestSchema>;

export const MapProviderSyncFindingParticipantRequestSchema = z.object({
  participantId: z.uuid().describe('A participant of the finding\'s sport league.'),
}).describe('Maps an UNMAPPED_PARTICIPANT finding\'s feed id to a participant, which resolves it.');
export type MapProviderSyncFindingParticipantRequest = z.infer<typeof MapProviderSyncFindingParticipantRequestSchema>;

registerSchema('ProviderSyncFindingDto', ProviderSyncFindingDtoSchema);
registerSchema('ProviderSyncFindingListResponse', ProviderSyncFindingListResponseSchema);
registerSchema('ProviderSyncFindingResponse', ProviderSyncFindingResponseSchema);
registerSchema('ChangeProviderSyncFindingStatusRequest', ChangeProviderSyncFindingStatusRequestSchema);
registerSchema('MapProviderSyncFindingParticipantRequest', MapProviderSyncFindingParticipantRequestSchema);
