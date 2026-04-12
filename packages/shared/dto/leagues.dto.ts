/**
 * League DTOs — request/response schemas for league endpoints.
 */
import { z } from 'zod';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

// --- Requests ---

export const CreateLeagueRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']),
  maxMembers: z.number().int().min(2).max(1000).optional(),
  sport: z.string().optional(),
  settings: JsonObjectSchema.optional(),
});
export type CreateLeagueRequest = z.infer<typeof CreateLeagueRequestSchema>;

export const UpdateLeagueRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']).optional(),
  maxMembers: z.number().int().min(2).max(1000).optional(),
});
export type UpdateLeagueRequest = z.infer<typeof UpdateLeagueRequestSchema>;

export const UpdateLeagueSettingsRequestSchema = z.object({
  isActive: z.boolean().optional(),
  invitePolicy: z.enum(['COMMISSIONER_ONLY', 'LINK_INVITE', 'OPEN']).optional(),
  allowMidSeasonJoin: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
  activityFeedEnabled: z.boolean().optional(),
  weeklyRecapEnabled: z.boolean().optional(),
  weeklyRecapDay: z.enum([
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ]).optional(),
  timezone: z.string().optional(),
  currency: z.string().optional(),
});
export type UpdateLeagueSettingsRequest = z.infer<typeof UpdateLeagueSettingsRequestSchema>;

export const SendLeagueInvitationsRequestSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(50),
  message: z.string().max(500).optional(),
});
export type SendLeagueInvitationsRequest = z.infer<typeof SendLeagueInvitationsRequestSchema>;

export const GenerateInviteLinkRequestSchema = z.object({
  expiresInDays: z.number().int().min(1).max(90).optional(),
  maxUses: z.number().int().min(0).optional(),
});
export type GenerateInviteLinkRequest = z.infer<typeof GenerateInviteLinkRequestSchema>;

export const ChangeLeagueMemberRoleRequestSchema = z.object({
  role: z.enum(['COMMISSIONER', 'MEMBER']),
  permissions: z.array(z.string()).optional(),
});
export type ChangeLeagueMemberRoleRequest = z.infer<typeof ChangeLeagueMemberRoleRequestSchema>;

export const CopySeasonRequestSchema = z.object({
  sourceContestIds: z.array(z.string()).min(1),
});
export type CopySeasonRequest = z.infer<typeof CopySeasonRequestSchema>;

export const CsvImportRowSchema = z.object({
  email: z.string(),
  displayName: z.string().optional(),
  role: z.string().optional(),
});
export type CsvImportRow = z.infer<typeof CsvImportRowSchema>;

export const ImportLeagueMembersRequestSchema = z.object({
  rows: z.array(CsvImportRowSchema).min(1).max(500),
});
export type ImportLeagueMembersRequest = z.infer<typeof ImportLeagueMembersRequestSchema>;

// --- Response Sub-schemas ---

export const LeagueSummaryDtoSchema = z.object({
  id: z.string(),
  leagueCode: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  visibility: z.string(),
  isActive: z.boolean(),
  memberCount: z.number(),
  activeContestCount: z.number(),
  role: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});
export type LeagueSummaryDto = z.infer<typeof LeagueSummaryDtoSchema>;

export const LeagueDetailDtoSchema = LeagueSummaryDtoSchema.extend({
  maxMembers: z.number().optional(),
  settings: z.record(z.unknown()).optional(),
  invitePolicy: z.string().optional(),
});
export type LeagueDetailDto = z.infer<typeof LeagueDetailDtoSchema>;

export const LeagueMemberDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string(),
  role: z.string(),
  joinedAt: z.string().datetime().optional(),
});
export type LeagueMemberDto = z.infer<typeof LeagueMemberDtoSchema>;

export const LeagueMembershipDtoSchema = z.object({
  id: z.string(),
  leagueId: z.string(),
  userId: z.string(),
  role: z.string(),
  status: z.string(),
  permissions: z.array(z.string()),
  joinedAt: DateTimeSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

export const LeagueInvitationDtoSchema = z.object({
  id: z.string(),
  leagueId: z.string(),
  email: z.string().nullable().optional(),
  inviteCode: z.string(),
  inviteType: z.string(),
  status: z.string(),
  maxUses: z.number().int(),
  currentUses: z.number().int(),
  invitedBy: z.string(),
  expiresAt: DateTimeSchema.nullable().optional(),
  acceptedAt: DateTimeSchema.nullable().optional(),
  acceptedBy: z.string().nullable().optional(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});
export type LeagueInvitationDto = z.infer<typeof LeagueInvitationDtoSchema>;

export const InvitationPreviewResponseSchema = z.object({
  invitation: z.object({
    inviteCode: z.string(),
    status: z.string(),
    league: z.object({
      id: z.string(),
      leagueCode: z.string(),
      name: z.string(),
    }),
  }),
});
export type InvitationPreviewResponse = z.infer<typeof InvitationPreviewResponseSchema>;

export const LeagueActionItemDtoSchema = z.object({
  id: z.string(),
  leagueId: z.string(),
  contestId: z.string().nullable().optional(),
  type: z.string(),
  priority: z.string(),
  title: z.string(),
  description: z.string(),
  actionUrl: z.string().nullable().optional(),
  resolved: z.boolean(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});
export type LeagueActionItemDto = z.infer<typeof LeagueActionItemDtoSchema>;

export const MemberActivityEventDtoSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  action: z.string(),
  timestamp: DateTimeSchema,
});
export type MemberActivityEventDto = z.infer<typeof MemberActivityEventDtoSchema>;

export const UpcomingEventDtoSchema = z.object({
  contestId: z.string().optional(),
  title: z.string(),
  date: DateTimeSchema,
  eventType: z.enum(['DRAFT_START', 'CONTEST_START', 'CONTEST_END', 'LOCK_TIME']),
});
export type UpcomingEventDto = z.infer<typeof UpcomingEventDtoSchema>;

export const LeagueAuditEntryDtoSchema = JsonObjectSchema;

// --- Responses ---

export const LeagueResponseSchema = z.object({
  league: LeagueDetailDtoSchema,
});
export type LeagueResponse = z.infer<typeof LeagueResponseSchema>;

export const LeagueListResponseSchema = z.object({
  leagues: z.array(LeagueSummaryDtoSchema),
});
export type LeagueListResponse = z.infer<typeof LeagueListResponseSchema>;

export const LeagueMembersResponseSchema = z.object({
  members: z.array(LeagueMemberDtoSchema),
});
export type LeagueMembersResponse = z.infer<typeof LeagueMembersResponseSchema>;

export const LeagueMembershipResponseSchema = z.object({
  membership: LeagueMembershipDtoSchema,
});

export const SendLeagueInvitationsResponseSchema = z.object({
  sent: z.array(LeagueInvitationDtoSchema),
  skippedMembers: z.array(z.string()),
  skippedDuplicates: z.array(z.string()),
});
export type SendLeagueInvitationsResponse = z.infer<typeof SendLeagueInvitationsResponseSchema>;

export const GenerateInviteLinkResponseSchema = z.object({
  invitation: LeagueInvitationDtoSchema,
});
export type GenerateInviteLinkResponse = z.infer<typeof GenerateInviteLinkResponseSchema>;

export const LeagueAuditEntriesResponseSchema = z.object({
  entries: z.array(LeagueAuditEntryDtoSchema),
});

export const LeagueDashboardResponseSchema = z.object({
  league: JsonObjectSchema,
  actionItems: z.array(LeagueActionItemDtoSchema),
  contests: z.array(JsonObjectSchema),
  memberCount: z.number().int(),
  pendingInvites: z.number().int(),
  recentMemberActivity: z.array(MemberActivityEventDtoSchema),
  upcomingEvents: z.array(UpcomingEventDtoSchema),
});
export type LeagueDashboardResponse = z.infer<typeof LeagueDashboardResponseSchema>;

export const ResolveActionItemResponseSchema = z.object({
  actionItem: LeagueActionItemDtoSchema,
});
export type ResolveActionItemResponse = z.infer<typeof ResolveActionItemResponseSchema>;

export const LeagueBulkOperationResponseSchema = JsonObjectSchema;
