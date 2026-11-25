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
  SlotKind,
  Sport,
} from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';
import { registerSchema } from './schema-registry';

export const ProviderSyncFindingSeveritySchema = z.enum(ProviderSyncFindingSeverity).describe('ERROR: synced data is wrong or missing until someone acts (it also raises the alarm when it opens). WARNING: something the sync skipped or guessed at. INFO: something it noticed and left alone on purpose.');
export const ProviderSyncFindingStatusSchema = z.enum(ProviderSyncFindingStatus).describe('OPEN until it is RESOLVED (an admin fixed it; a missing webhook secret also resolves once it is set) or WAIVED (an admin accepted it, with a note). A waived finding stays waived when the sync sees it again; a resolved one opens again.');
export const ProviderSyncFindingKindSchema = z.enum(ProviderSyncFindingKind).describe('What it is about. UNMAPPED_PARTICIPANT: the feed sent a participant id no participant of the league is mapped to (providerValue). WEBHOOK_SECRET_MISSING: the Provider\'s webhooks are on but its signing secret is not set here. PROVIDER_RATE_LIMITED: the Provider has rate limited every call for a while (WARNING after 15 minutes, ERROR after the league\'s quiet threshold); it resolves on the Provider\'s next answer. SLOT_NAME_UNMATCHED: a tournament whose normalized name (providerValue) no NAME_PATTERN mapping of the league matches, so it has no Season slot (INFO; LINK_SLOT adds the name as a pattern). SLOT_NAME_AMBIGUOUS: a tournament whose normalized name matches more than one slot, or one another tournament already has (ERROR).');
export const ProviderSyncFindingActionSchema = z.enum(ProviderSyncFindingAction).describe('MAP_PARTICIPANT: mapProviderSyncFindingParticipant. LINK_SLOT: listProviderSyncFindingSlotChoices, then linkProviderSyncFindingSlot. RESOLVE, WAIVE (with a note) and REOPEN: changeProviderSyncFindingStatus.');

export const ProviderSyncFindingDtoSchema = z.object({
  id: z.uuid(),
  kind: ProviderSyncFindingKindSchema,
  severity: ProviderSyncFindingSeveritySchema,
  status: ProviderSyncFindingStatusSchema,
  sportLeague: z.object({ id: z.uuid(), name: z.string(), sport: z.enum(Sport) }).describe('The sport league it is about: every finding has one.'),
  sportEvent: z.object({ id: z.uuid(), name: z.string() }).nullable().describe('The event it is about; null when its kind names none.'),
  provider: z.object({ id: z.uuid(), name: z.string() }).nullable().describe('The Provider it is about; null when its kind names none.'),
  providerValue: z.string().nullable().describe('What the feed sent that nothing maps: an UNMAPPED_PARTICIPANT\'s participant id as the feed sent it, or a SLOT_NAME_ finding\'s normalized tournament name; null when its kind has none.'),
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
  actions: z.array(ProviderSyncFindingActionSchema).describe('What a root admin can do with it now, in the order to offer them. An OPEN finding offers its kind\'s own fix first (MAP_PARTICIPANT, LINK_SLOT), then RESOLVE and WAIVE; a resolved or waived one offers REOPEN.'),
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

const ProviderSyncFindingSlotChoiceDtoSchema = z.object({
  slotDefinitionId: z.uuid().describe('The slot definition (SportLeagueSlotDefinitionDto.id).'),
  key: z.string().describe('Its key in the sport league, such as MASTERS.'),
  slotKind: z.enum(SlotKind),
  weekNumber: z.number().int().min(1).nullable().describe('The week\'s number in its phase; set only on a WEEK slot.'),
  name: z.string().nullable().describe('The league\'s own name for it (Masters Tournament); null when screens show the word for its kind.'),
  patterns: z.array(z.string()).describe('The normalized names that already place a tournament on it, in order.'),
}).describe('A slot definition a SLOT_NAME_UNMATCHED finding\'s tournament can be linked to.');
export type ProviderSyncFindingSlotChoiceDto = z.infer<typeof ProviderSyncFindingSlotChoiceDtoSchema>;

export const ProviderSyncFindingSlotChoiceListResponseSchema = z.object({
  slots: z.array(ProviderSyncFindingSlotChoiceDtoSchema).describe('Every slot definition the finding\'s sport league matches tournaments to by name through its mapping to the finding\'s Provider, by key. Never paged.'),
}).describe('The slots "link to existing" offers.');
export type ProviderSyncFindingSlotChoiceListResponse = z.infer<typeof ProviderSyncFindingSlotChoiceListResponseSchema>;

const LinkProviderSyncFindingSlotRequestSchema = z.object({
  slotDefinitionId: z.uuid().describe('One of the slot definitions listProviderSyncFindingSlotChoices offers.'),
}).describe('Adds a SLOT_NAME_UNMATCHED finding\'s tournament name as a pattern of a slot definition, which resolves it.');
export type LinkProviderSyncFindingSlotRequest = z.infer<typeof LinkProviderSyncFindingSlotRequestSchema>;

registerSchema('ProviderSyncFindingDto', ProviderSyncFindingDtoSchema);
registerSchema('ProviderSyncFindingSlotChoiceDto', ProviderSyncFindingSlotChoiceDtoSchema);
registerSchema('ProviderSyncFindingSlotChoiceListResponse', ProviderSyncFindingSlotChoiceListResponseSchema);
registerSchema('LinkProviderSyncFindingSlotRequest', LinkProviderSyncFindingSlotRequestSchema);
registerSchema('ProviderSyncFindingListResponse', ProviderSyncFindingListResponseSchema);
registerSchema('ProviderSyncFindingResponse', ProviderSyncFindingResponseSchema);
registerSchema('ChangeProviderSyncFindingStatusRequest', ChangeProviderSyncFindingStatusRequestSchema);
registerSchema('MapProviderSyncFindingParticipantRequest', MapProviderSyncFindingParticipantRequestSchema);
