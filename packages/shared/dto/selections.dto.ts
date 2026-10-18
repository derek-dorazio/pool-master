/**
 * Selection DTOs — request/response schemas for the selection endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { ContestEntryStatus, SelectionStatus, SelectionType } from '../domain/enums';

// --- Requests ---

export const SelectionStateQuerySchema = z.object({
  entryId: z.string().optional().describe('Specific contest entry to view within roster-based selection flows.'),
  sportEventId: z.string().uuid().optional().describe('The contest event whose picks to show (#713). Defaults to the contest\'s next event that has not started, else its last event.'),
}).describe('Optional query parameters for loading selection state.');
export type SelectionStateQuery = z.infer<typeof SelectionStateQuerySchema>;

export const SubmitPickRequestSchema = z.object({
  entryId: z.string().describe('Entry making the pick.'),
  participantId: z.string().describe('Participant being selected.'),
}).describe('Request payload for submitting a pick.');
export type SubmitPickRequest = z.infer<typeof SubmitPickRequestSchema>;

// --- Response Sub-schemas ---

export const PickHistoryDtoSchema = z.object({
  pickNumber: z.number(),
  round: z.number(),
  pickInRound: z.number(),
  entryId: z.string(),
  entryName: z.string(),
  participantId: z.string().nullable(),
  participantName: z.string().nullable(),
  role: z.string().optional(),
  team: z.string().optional(),
  price: z.number().optional(),
  tierId: z.string().optional(),
  tierName: z.string().optional(),
  autoPicked: z.boolean(),
  isSkipped: z.boolean().optional(),
  pickedAt: z.string().datetime().describe('When the pick was made or skipped.'),
}).describe('Historical pick row shown in selection-room history.');
export type PickHistoryDto = z.infer<typeof PickHistoryDtoSchema>;

export const SelectionEntryDtoSchema = z.object({
  id: z.string().describe('Entry identifier.'),
  userId: z.string().describe('User that owns the entry.'),
  name: z.string().describe('Entry display name.'),
  status: z.nativeEnum(ContestEntryStatus).describe('The entry\'s status in the shown event (#713): DRAFT until the owner submits a complete lineup for it; SUBMITTED once they have. A pick change that leaves the lineup short sends it back to DRAFT (#481).'),
}).describe('Entry summary shown in the selection room.');
export type SelectionEntryDto = z.infer<typeof SelectionEntryDtoSchema>;

export const SelectionParticipantDtoSchema = z.object({
  sportEventParticipantId: z.string(),
  participantId: z.string(),
  participantName: z.string(),
  role: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  ranking: z.number().nullable().optional(),
  seedNumber: z.number().int().nullable().describe('The bracket seed, 1 the best, shown in the selection room for a knockout event; null where the event seeds nobody.'),
  orderIndex: z.number().nullable().optional(),
  isAvailable: z.boolean(),
  isSelected: z.boolean().optional().describe('Whether the currently selected entry has this participant selected.'),
}).describe('Selectable participant row used by roster-based entry builders.');
export type SelectionParticipantDto = z.infer<typeof SelectionParticipantDtoSchema>;

export const SelectionGroupDtoSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  groupNumber: z.number(),
  picksFromGroup: z.number(),
  selectedParticipantIds: z.array(z.string()).describe('Selections currently saved on the selected entry for this group.'),
  participants: z.array(SelectionParticipantDtoSchema).describe('Selectable participants shown inside the group.'),
}).describe('Contest-specific selection group used by tiered or budget-style entry builders.');
export type SelectionGroupDto = z.infer<typeof SelectionGroupDtoSchema>;

export const SelectionBudgetLineupSummaryDtoSchema = z.object({
  selectionType: z.literal(SelectionType.BUDGET_PICK),
  salaryCap: z.number().describe('Whole dollars the entry\'s picks may cost at most: its event\'s cap.'),
  spent: z.number().describe('What the entry\'s picks cost, in dollars, summed in cents.'),
  remaining: z.number().describe('Cap minus spent; negative while the entry is over budget.'),
  isOverBudget: z.boolean().describe('Whether the picks cost more than the cap. Picks are still allowed; submitting is refused with 409 ENTRY_OVER_BUDGET.'),
  openSlots: z.number().int().describe('Roster places the entry has yet to fill.'),
  cheapestFill: z.number().nullable().describe('What the cheapest available golfers not on the entry would cost to fill its open places; null when the field cannot fill them. For a warning only, never a block.'),
}).describe('Budget contest: the viewed entry\'s spend against the salary cap (#93).');
export type SelectionBudgetLineupSummaryDto = z.infer<typeof SelectionBudgetLineupSummaryDtoSchema>;

// --- Responses ---

export const SelectionStateResponseSchema = z.object({
  contestId: z.string(),
  contestName: z.string(),
  sportEventId: z.string().describe('The contest event the room shows (#713): its field, its picks, and each entry\'s status in it.'),
  acceptsPicks: z.boolean().describe('Whether this event\'s picks can still change: the contest is open or live, it has not been drawn, and the event has not started.'),
  selectionType: z.nativeEnum(SelectionType),
  drawnAt: z.string().datetime().nullable().describe('When a random-draw contest\'s draw dealt its picks, closing its entries and revealing every entry\'s picks. Null until then, and always for other selection types.'),
  isCommissioner: z.boolean().optional(),
  rosterSize: z.number(),
  status: z.enum([
    SelectionStatus.PENDING,
    SelectionStatus.LIVE,
    SelectionStatus.PAUSED,
    SelectionStatus.COMPLETE,
  ]),
  myEntryId: z.string().nullable(),
  entries: z.array(SelectionEntryDtoSchema),
  pickHistories: z.array(PickHistoryDtoSchema),
  availableParticipantIds: z.array(z.string()),
  selectedEntryId: z.string().nullable().optional(),
  selectedEntryName: z.string().nullable().optional(),
  tiebreakerValue: z.number().nullable().optional(),
  selectionGroups: z.array(SelectionGroupDtoSchema).optional(),
  isComplete: z.boolean(),
  lineupSummary: SelectionBudgetLineupSummaryDtoSchema.nullable().optional().describe('The viewed entry\'s lineup summary, tagged by selection type: only budget contests carry one today. Null when there is no viewed entry or the type has none.'),
}).describe('Selection-state response.');
export type SelectionStateResponse = z.infer<typeof SelectionStateResponseSchema>;

export const SelectionPickResponseSchema = z.object({
  contestId: z.string(),
  contestName: z.string(),
  sportEventId: z.string().describe('The contest event the room shows (#713): its field, its picks, and each entry\'s status in it.'),
  acceptsPicks: z.boolean().describe('Whether this event\'s picks can still change: the contest is open or live, it has not been drawn, and the event has not started.'),
  selectionType: z.nativeEnum(SelectionType),
  drawnAt: z.string().datetime().nullable().describe('When a random-draw contest\'s draw dealt its picks, closing its entries and revealing every entry\'s picks. Null until then, and always for other selection types.'),
  isCommissioner: z.boolean().optional(),
  rosterSize: z.number(),
  status: z.enum([
    SelectionStatus.PENDING,
    SelectionStatus.LIVE,
    SelectionStatus.PAUSED,
    SelectionStatus.COMPLETE,
  ]),
  myEntryId: z.string().nullable(),
  entries: z.array(SelectionEntryDtoSchema),
  pickHistories: z.array(PickHistoryDtoSchema),
  availableParticipantIds: z.array(z.string()),
  selectedEntryId: z.string().nullable().optional(),
  selectedEntryName: z.string().nullable().optional(),
  tiebreakerValue: z.number().nullable().optional(),
  selectionGroups: z.array(SelectionGroupDtoSchema).optional(),
  isComplete: z.boolean(),
  lineupSummary: SelectionBudgetLineupSummaryDtoSchema.nullable().optional().describe('The viewed entry\'s lineup summary, tagged by selection type: only budget contests carry one today. Null when there is no viewed entry or the type has none.'),
}).describe('Selection response returned immediately after a pick mutation.');
export type SelectionPickResponse = z.infer<typeof SelectionPickResponseSchema>;

registerSchema('SelectionStateQuery', SelectionStateQuerySchema);
registerSchema('SubmitPickRequest', SubmitPickRequestSchema);
registerSchema('SelectionBudgetLineupSummaryDto', SelectionBudgetLineupSummaryDtoSchema);
registerSchema('SelectionStateResponse', SelectionStateResponseSchema);
registerSchema('SelectionPickResponse', SelectionPickResponseSchema);
