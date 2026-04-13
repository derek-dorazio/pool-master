/**
 * League DTOs — request/response schemas for league endpoints.
 */
import { z } from 'zod';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

// --- Requests ---

export const CreateLeagueRequestSchema = z.object({
  name: z.string().min(1).max(100).describe('Primary league name shown in selectors, invites, and league home.'),
  description: z.string().max(500).optional().describe('Optional short description or commissioner-facing summary for the league.'),
  visibility: z
    .enum(['PUBLIC', 'PRIVATE', 'UNLISTED'])
    .describe('Discovery mode for the league. Current web flows mostly assume private or invite-led leagues.'),
  maxMembers: z.number().int().min(2).max(1000).optional().describe('Optional league membership cap.'),
  sport: z.string().optional().describe('Optional sport or category label used for future templates and filtering.'),
  settings: JsonObjectSchema.optional().describe('Optional advanced settings payload merged into the default league settings.'),
}).describe('Commissioner request payload for creating a new league.');
export type CreateLeagueRequest = z.infer<typeof CreateLeagueRequestSchema>;

export const UpdateLeagueRequestSchema = z.object({
  name: z.string().min(1).max(100).optional().describe('Updated league display name.'),
  description: z.string().max(500).optional().describe('Updated league description.'),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']).optional().describe('Updated league visibility mode.'),
  maxMembers: z.number().int().min(2).max(1000).optional().describe('Updated membership cap.'),
}).describe('Commissioner patch payload for editable league metadata.');
export type UpdateLeagueRequest = z.infer<typeof UpdateLeagueRequestSchema>;

export const UpdateLeagueSettingsRequestSchema = z.object({
  isActive: z
    .boolean()
    .optional()
    .describe('League activity flag. Inactive leagues remain readable but should restrict write actions in the web app.'),
  invitePolicy: z
    .enum(['COMMISSIONER_ONLY', 'LINK_INVITE', 'OPEN'])
    .optional()
    .describe('Invitation policy controlling whether members join only through commissioners, links, or open enrollment.'),
  allowMidSeasonJoin: z.boolean().optional().describe('Whether members may join after the league has already started.'),
  requireApproval: z.boolean().optional().describe('Whether commissioner approval is required before a join becomes active.'),
  activityFeedEnabled: z.boolean().optional().describe('Whether league activity should appear in future feed surfaces.'),
  weeklyRecapEnabled: z.boolean().optional().describe('Whether the league wants a recurring weekly recap delivery.'),
  weeklyRecapDay: z.enum([
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ]).optional().describe('Day of week for future recap scheduling.'),
  timezone: z.string().optional().describe('League-level timezone override used for schedule-oriented displays.'),
  currency: z.string().optional().describe('Default currency code for league-level money displays.'),
}).describe('Commissioner-managed settings patch for a league.');
export type UpdateLeagueSettingsRequest = z.infer<typeof UpdateLeagueSettingsRequestSchema>;

export const SendLeagueInvitationsRequestSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(50).describe('Email recipients to invite into the league.'),
  message: z.string().max(500).optional().describe('Optional commissioner note included with the invitation email.'),
}).describe('Commissioner request payload for sending direct email invites.');
export type SendLeagueInvitationsRequest = z.infer<typeof SendLeagueInvitationsRequestSchema>;

export const GenerateInviteLinkRequestSchema = z.object({
  expiresInDays: z.number().int().min(1).max(90).optional().describe('Optional invite-link lifetime in days.'),
  maxUses: z.number().int().min(0).optional().describe('Optional maximum number of accepted joins. Zero means unlimited use.'),
}).describe('Commissioner request payload for creating a shareable invite link.');
export type GenerateInviteLinkRequest = z.infer<typeof GenerateInviteLinkRequestSchema>;

export const ChangeLeagueMemberRoleRequestSchema = z.object({
  role: z
    .enum(['COMMISSIONER', 'MEMBER'])
    .describe('Target membership role after the change. Commissioner grants league-administration access.'),
  permissions: z.array(z.string()).optional().describe('Optional explicit permission override list for the member.'),
}).describe('Commissioner-managed membership role update payload.');
export type ChangeLeagueMemberRoleRequest = z.infer<typeof ChangeLeagueMemberRoleRequestSchema>;

export const AcceptInvitationRequestSchema = z.object({
  inviteCode: z.string().min(1).describe('Invite code from the invite URL or invitation email.'),
}).describe('Authenticated invitation-acceptance payload.');
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;

export const CopySeasonRequestSchema = z.object({
  sourceContestIds: z.array(z.string()).min(1).describe('Contests from the source season that should be copied forward.'),
}).describe('Commissioner request payload for copying a prior season into a new one.');
export type CopySeasonRequest = z.infer<typeof CopySeasonRequestSchema>;

export const CsvImportRowSchema = z.object({
  email: z.string().describe('Email address for the imported member row.'),
  displayName: z.string().optional().describe('Optional display name supplied in the import row.'),
  role: z.string().optional().describe('Optional requested league role for the imported member.'),
}).describe('Single CSV-style member import row.');
export type CsvImportRow = z.infer<typeof CsvImportRowSchema>;

export const ImportLeagueMembersRequestSchema = z.object({
  rows: z.array(CsvImportRowSchema).min(1).max(500).describe('Rows to import as league members.'),
}).describe('Commissioner request payload for importing league members.');
export type ImportLeagueMembersRequest = z.infer<typeof ImportLeagueMembersRequestSchema>;

// --- Response Sub-schemas ---

export const LeagueSummaryDtoSchema = z.object({
  id: z.string().describe('Internal league identifier used for authenticated management APIs.'),
  leagueCode: z.string().describe('Stable short code used in bookmarkable league-home routes and invite context.'),
  name: z.string().describe('Primary display name for the league.'),
  description: z.string().nullable().optional().describe('Optional short league description.'),
  visibility: z.string().describe('Current league visibility mode.'),
  isActive: z.boolean().describe('Whether the league is currently active for normal write interactions.'),
  memberCount: z.number().describe('Current number of memberships in the league.'),
  activeContestCount: z.number().describe('Number of currently active contests associated with the league.'),
  role: z.string().optional().describe('Current user role in the league when the response is viewer-scoped.'),
  createdAt: z.string().datetime().optional().describe('League creation timestamp in ISO 8601 format.'),
}).describe('League list item used for selectors, welcome screens, and league overviews.');
export type LeagueSummaryDto = z.infer<typeof LeagueSummaryDtoSchema>;

export const LeagueDetailDtoSchema = LeagueSummaryDtoSchema.extend({
  maxMembers: z.number().optional().describe('Optional maximum number of allowed league members.'),
  settings: z.record(z.unknown()).optional().describe('League settings object as currently persisted for commissioner-driven controls.'),
  invitePolicy: z.string().optional().describe('Current invitation policy resolved from league settings.'),
}).describe('Detailed league payload used by league-home and league-settings surfaces.');
export type LeagueDetailDto = z.infer<typeof LeagueDetailDtoSchema>;

export const LeagueMemberDtoSchema = z.object({
  id: z.string().describe('Membership record identifier.'),
  userId: z.string().describe('User account identifier for the member.'),
  displayName: z.string().describe('Display name shown in member-management surfaces.'),
  role: z.string().describe('League role for the member, such as COMMISSIONER or MEMBER.'),
  joinedAt: z.string().datetime().optional().describe('When the user joined or was activated in the league.'),
}).describe('League membership summary shown in member-management views.');
export type LeagueMemberDto = z.infer<typeof LeagueMemberDtoSchema>;

export const LeagueMembershipDtoSchema = z.object({
  id: z.string().describe('Membership record identifier.'),
  leagueId: z.string().describe('League that owns the membership.'),
  userId: z.string().describe('User account attached to the membership.'),
  role: z.string().describe('Current league role for the user.'),
  status: z.string().describe('Membership lifecycle state.'),
  permissions: z.array(z.string()).describe('Explicit commissioner permission overrides granted to the membership.'),
  joinedAt: DateTimeSchema.describe('When the user joined the league.'),
  createdAt: DateTimeSchema.describe('When the membership record was created.'),
  updatedAt: DateTimeSchema.describe('When the membership record was last updated.'),
}).describe('Detailed league membership record.');

export const LeagueInvitationDtoSchema = z.object({
  id: z.string().describe('Invitation record identifier.'),
  leagueId: z.string().describe('League that owns the invitation.'),
  email: z.string().nullable().optional().describe('Email recipient for direct email invites. Link invites omit this field.'),
  inviteCode: z.string().describe('Shareable invitation code used in URLs and acceptance requests.'),
  inviteType: z.string().describe('Invitation delivery mode, such as EMAIL or LINK.'),
  status: z.string().describe('Invitation lifecycle state, such as PENDING, ACCEPTED, REVOKED, or EXPIRED.'),
  maxUses: z.number().int().describe('Maximum accepted joins allowed for the invitation.'),
  currentUses: z.number().int().describe('How many times the invitation has already been accepted.'),
  invitedBy: z.string().describe('User ID of the commissioner or actor that issued the invite.'),
  expiresAt: DateTimeSchema.nullable().optional().describe('When the invite stops being valid, if it expires.'),
  acceptedAt: DateTimeSchema.nullable().optional().describe('When the invitation was accepted, if applicable.'),
  acceptedBy: z.string().nullable().optional().describe('User ID that accepted the invite, when known.'),
  createdAt: DateTimeSchema.describe('Invitation creation timestamp.'),
  updatedAt: DateTimeSchema.describe('Last invitation update timestamp.'),
}).describe('Invitation record returned from commissioner invite-management APIs.');
export type LeagueInvitationDto = z.infer<typeof LeagueInvitationDtoSchema>;

export const InvitationPreviewResponseSchema = z.object({
  invitation: z.object({
    inviteCode: z.string().describe('Invitation code currently being previewed.'),
    status: z.string().describe('Current invitation lifecycle state.'),
    league: z.object({
      id: z.string().describe('League ID associated with the invitation.'),
      leagueCode: z.string().describe('Bookmarkable short code for the invited league.'),
      name: z.string().describe('Display name for the invited league.'),
    }).describe('Minimal league identity shown before accepting the invite.'),
  }).describe('Public invitation preview shown before or after authentication.'),
}).describe('Invitation preview payload used by `/invite/<inviteCode>` flows.');
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
  createdAt: DateTimeSchema.describe('When the action item was created.'),
  updatedAt: DateTimeSchema.describe('When the action item was last updated.'),
}).describe('Commissioner dashboard action item.');
export type LeagueActionItemDto = z.infer<typeof LeagueActionItemDtoSchema>;

export const MemberActivityEventDtoSchema = z.object({
  userId: z.string().describe('User involved in the activity event.'),
  displayName: z.string().describe('Display name shown for the member activity event.'),
  action: z.string().describe('Normalized member activity action label.'),
  timestamp: DateTimeSchema.describe('When the member activity occurred.'),
}).describe('Recent member activity row used on commissioner dashboards.');
export type MemberActivityEventDto = z.infer<typeof MemberActivityEventDtoSchema>;

export const UpcomingEventDtoSchema = z.object({
  contestId: z.string().optional(),
  title: z.string(),
  date: DateTimeSchema,
  eventType: z.enum(['DRAFT_START', 'CONTEST_START', 'CONTEST_END', 'LOCK_TIME']).describe('Upcoming event category.'),
}).describe('Upcoming league event summary.');
export type UpcomingEventDto = z.infer<typeof UpcomingEventDtoSchema>;

export const LeagueAuditEntryDtoSchema = JsonObjectSchema;

// --- Responses ---

export const LeagueResponseSchema = z.object({
  league: LeagueDetailDtoSchema,
}).describe('Single-league detail response.');
export type LeagueResponse = z.infer<typeof LeagueResponseSchema>;

export const LeagueListResponseSchema = z.object({
  leagues: z.array(LeagueSummaryDtoSchema),
}).describe('League-list response.');
export type LeagueListResponse = z.infer<typeof LeagueListResponseSchema>;

export const LeagueMembersResponseSchema = z.object({
  members: z.array(LeagueMemberDtoSchema),
}).describe('League-members response.');
export type LeagueMembersResponse = z.infer<typeof LeagueMembersResponseSchema>;

export const LeagueMembershipResponseSchema = z.object({
  membership: LeagueMembershipDtoSchema,
}).describe('Single league-membership response.');

export const SendLeagueInvitationsResponseSchema = z.object({
  sent: z.array(LeagueInvitationDtoSchema).describe('Invitation records successfully created and sent.'),
  skippedMembers: z.array(z.string()).describe('Emails skipped because they already belong to the league.'),
  skippedDuplicates: z.array(z.string()).describe('Emails skipped because they were duplicated in the request or invite set.'),
}).describe('League invitation-send response.');
export type SendLeagueInvitationsResponse = z.infer<typeof SendLeagueInvitationsResponseSchema>;

export const GenerateInviteLinkResponseSchema = z.object({
  invitation: LeagueInvitationDtoSchema,
}).describe('Generated invite-link response.');
export type GenerateInviteLinkResponse = z.infer<typeof GenerateInviteLinkResponseSchema>;

export const LeagueAuditEntriesResponseSchema = z.object({
  entries: z.array(LeagueAuditEntryDtoSchema),
}).describe('League audit-log response.');

export const LeagueDashboardResponseSchema = z.object({
  league: JsonObjectSchema.describe('League summary payload driving the dashboard header.'),
  actionItems: z.array(LeagueActionItemDtoSchema).describe('Outstanding commissioner action items.'),
  contests: z.array(JsonObjectSchema).describe('Contest summaries included in the dashboard payload.'),
  memberCount: z.number().int().describe('Current league member count.'),
  pendingInvites: z.number().int().describe('Current number of pending invitations.'),
  recentMemberActivity: z.array(MemberActivityEventDtoSchema).describe('Recent member activity for the league.'),
  upcomingEvents: z.array(UpcomingEventDtoSchema).describe('Upcoming league events that should be surfaced on the dashboard.'),
}).describe('Commissioner dashboard response.');
export type LeagueDashboardResponse = z.infer<typeof LeagueDashboardResponseSchema>;

export const ResolveActionItemResponseSchema = z.object({
  actionItem: LeagueActionItemDtoSchema,
}).describe('Action-item resolution response.');
export type ResolveActionItemResponse = z.infer<typeof ResolveActionItemResponseSchema>;

export const LeagueBulkOperationResponseSchema = JsonObjectSchema;
