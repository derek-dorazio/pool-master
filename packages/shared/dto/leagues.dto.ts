/**
 * League DTOs — request/response schemas for league endpoints.
 */
import { z } from 'zod';
import {
  InvitationStatus,
  JoinPolicy,
  InviteType,
  LeagueIconKey,
  LeagueMembershipStatus,
  LeagueRole,
} from '../domain/enums';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

// --- Requests ---

export const CreateLeagueRequestSchema = z.object({
  name: z.string().min(1).max(100).describe('Primary league name shown in selectors, invites, and league home.'),
  leagueCode: z
    .string()
    .regex(/^[A-Z0-9]{3,16}$/)
    .describe('Required unique league route code used in bookmarkable URLs such as `/league/<leagueCode>`.'),
  description: z.string().max(500).optional().describe('Optional short description or commissioner-facing summary for the league.'),
}).describe('Commissioner request payload for creating a new private league.');
export type CreateLeagueRequest = z.infer<typeof CreateLeagueRequestSchema>;

export const DeleteLeagueRequestSchema = z.object({
  leagueCode: z
    .string()
    .regex(/^[A-Z0-9]{3,16}$/)
    .describe('Exact league code confirmation required before permanently deleting an inactive league.'),
}).describe('Commissioner confirmation payload for permanently deleting an inactive league.');
export type DeleteLeagueRequest = z.infer<typeof DeleteLeagueRequestSchema>;

export const UpdateLeagueDetailsRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('Updated primary league name shown in selectors, tiles, and league home.'),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe('Optional updated commissioner-facing league description. Omit or send an empty value to clear it.'),
}).describe('Commissioner request payload for editing league details while the league remains active.');
export type UpdateLeagueDetailsRequest = z.infer<typeof UpdateLeagueDetailsRequestSchema>;

export const UpdateLeagueIconRequestSchema = z.object({
  iconKey: z
    .enum([
      LeagueIconKey.GOLF_FLAG,
      LeagueIconKey.GOLF_BALL,
      LeagueIconKey.FOOTBALL,
      LeagueIconKey.FOOTBALL_HELMET,
      LeagueIconKey.BASKETBALL,
      LeagueIconKey.BASKETBALL_HOOP,
      LeagueIconKey.CHECKERED_FLAG,
      LeagueIconKey.RACING_WHEEL,
      LeagueIconKey.TENNIS_BALL,
      LeagueIconKey.TENNIS_RACKET,
      LeagueIconKey.HORSESHOE,
      LeagueIconKey.SOCCER_BALL,
      LeagueIconKey.HOCKEY_STICK,
      LeagueIconKey.HOCKEY_PUCK,
      LeagueIconKey.BASEBALL,
      LeagueIconKey.BASEBALL_BAT,
      LeagueIconKey.FIGHT_GLOVE,
      LeagueIconKey.TROPHY,
      LeagueIconKey.WHISTLE,
      LeagueIconKey.STOPWATCH,
    ])
    .describe('Selected built-in league icon from the curated PoolMaster icon catalog.'),
}).describe('Commissioner request payload for selecting a built-in league icon.');
export type UpdateLeagueIconRequest = z.infer<typeof UpdateLeagueIconRequestSchema>;

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
    .enum([LeagueRole.COMMISSIONER, LeagueRole.MEMBER])
    .describe('Target membership role after the change. Commissioner grants league-administration access.'),
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
  firstName: z.string().optional().describe('Optional first name supplied in the import row.'),
  lastName: z.string().optional().describe('Optional last name supplied in the import row.'),
  role: z
    .enum([LeagueRole.COMMISSIONER, LeagueRole.MEMBER])
    .optional()
    .describe('Optional requested league role for the imported member.'),
}).describe('Single CSV-style member import row.');
export type CsvImportRow = z.infer<typeof CsvImportRowSchema>;

export const ImportLeagueMembersRequestSchema = z.object({
  rows: z.array(CsvImportRowSchema).min(1).max(500).describe('Rows to import as league members.'),
}).describe('Commissioner request payload for importing league members.');
export type ImportLeagueMembersRequest = z.infer<typeof ImportLeagueMembersRequestSchema>;

// --- Response Sub-schemas ---

export const LeagueRelationshipDtoSchema = z.object({
  leagueMember: z
    .boolean()
    .describe('Whether the current requester is an active member of this league.'),
  commissioner: z
    .boolean()
    .describe('Whether the current requester is an active commissioner of this league.'),
}).describe('Requester-scoped relationship to the target league. This is relationship context, not a generic permission matrix.');
export type LeagueRelationshipDto = z.infer<typeof LeagueRelationshipDtoSchema>;

export const LeagueSummaryDtoSchema = z.object({
  id: z.string().describe('Internal league identifier used for authenticated management APIs.'),
  leagueCode: z.string().describe('Stable short code used in bookmarkable league-home routes and invite context.'),
  name: z.string().describe('Primary display name for the league.'),
  description: z.string().nullable().optional().describe('Optional short league description.'),
  isActive: z.boolean().describe('Whether the league is currently active for normal write interactions.'),
  iconKey: z
    .enum([
      LeagueIconKey.GOLF_FLAG,
      LeagueIconKey.GOLF_BALL,
      LeagueIconKey.FOOTBALL,
      LeagueIconKey.FOOTBALL_HELMET,
      LeagueIconKey.BASKETBALL,
      LeagueIconKey.BASKETBALL_HOOP,
      LeagueIconKey.CHECKERED_FLAG,
      LeagueIconKey.RACING_WHEEL,
      LeagueIconKey.TENNIS_BALL,
      LeagueIconKey.TENNIS_RACKET,
      LeagueIconKey.HORSESHOE,
      LeagueIconKey.SOCCER_BALL,
      LeagueIconKey.HOCKEY_STICK,
      LeagueIconKey.HOCKEY_PUCK,
      LeagueIconKey.BASEBALL,
      LeagueIconKey.BASEBALL_BAT,
      LeagueIconKey.FIGHT_GLOVE,
      LeagueIconKey.TROPHY,
      LeagueIconKey.WHISTLE,
      LeagueIconKey.STOPWATCH,
    ])
    .describe('Selected built-in league icon key from the curated PoolMaster icon catalog.'),
  memberCount: z.number().describe('Current number of memberships in the league.'),
  activeContestCount: z.number().describe('Number of currently active contests associated with the league.'),
  memberType: z
    .enum([LeagueRole.COMMISSIONER, LeagueRole.MEMBER])
    .nullable()
    .describe('Describes the current requester’s actual league membership type when they are an active member. This field is descriptive only and must not be used for authorization checks.'),
  leagueRelationship: LeagueRelationshipDtoSchema,
  isRootAdmin: z
    .boolean()
    .describe('Whether the current requester has platform-level root-admin authority. This is global platform state, not league relationship data.'),
  createdAt: z.string().datetime().optional().describe('League creation timestamp in ISO 8601 format.'),
}).describe('League list item used for selectors, welcome screens, and league overviews.');
export type LeagueSummaryDto = z.infer<typeof LeagueSummaryDtoSchema>;

export const LeagueDetailDtoSchema = LeagueSummaryDtoSchema.extend({
  joinPolicy: z
    .enum([JoinPolicy.COMMISSIONER_ONLY, JoinPolicy.LINK_INVITE, JoinPolicy.OPEN])
    .describe('League join policy controlling whether membership comes only through commissioners, shareable invite links, or open enrollment.'),
}).describe('Detailed league payload used by league-home and commissioner-management surfaces.');
export type LeagueDetailDto = z.infer<typeof LeagueDetailDtoSchema>;

export const LeagueMemberDtoSchema = z.object({
  id: z.string().describe('Membership record identifier.'),
  userId: z.string().describe('User account identifier for the member.'),
  email: z.string().email().describe('Email address for the member account.'),
  firstName: z.string().describe('First name shown in member-management surfaces.'),
  lastName: z.string().describe('Last name shown in member-management surfaces.'),
  role: z
    .enum([LeagueRole.COMMISSIONER, LeagueRole.MEMBER])
    .describe('League role for the member, such as COMMISSIONER or MEMBER.'),
  joinedAt: z.string().datetime().optional().describe('When the user joined or was activated in the league.'),
}).describe('League membership summary shown in member-management views.');
export type LeagueMemberDto = z.infer<typeof LeagueMemberDtoSchema>;

export const LeagueMembershipDtoSchema = z.object({
  id: z.string().describe('Membership record identifier.'),
  leagueId: z.string().describe('League that owns the membership.'),
  userId: z.string().describe('User account attached to the membership.'),
  role: z
    .enum([LeagueRole.COMMISSIONER, LeagueRole.MEMBER])
    .describe('Current league role for the user.'),
  status: z
    .enum([LeagueMembershipStatus.ACTIVE, LeagueMembershipStatus.INACTIVE])
    .describe('Membership lifecycle state.'),
  joinedAt: DateTimeSchema.describe('When the user joined the league.'),
  createdAt: DateTimeSchema.describe('When the membership record was created.'),
  updatedAt: DateTimeSchema.describe('When the membership record was last updated.'),
}).describe('Detailed league membership record.');

export const LeagueInvitationDtoSchema = z.object({
  id: z.string().describe('Invitation record identifier.'),
  leagueId: z.string().describe('League that owns the invitation.'),
  email: z.string().nullable().optional().describe('Email recipient for direct email invites. Link invites omit this field.'),
  inviteCode: z.string().describe('Shareable invitation code used in URLs and acceptance requests.'),
  inviteType: z
    .enum([InviteType.EMAIL, InviteType.LINK])
    .describe('Invitation delivery mode, such as EMAIL or LINK.'),
  status: z
    .enum([
      InvitationStatus.PENDING,
      InvitationStatus.ACCEPTED,
      InvitationStatus.EXPIRED,
      InvitationStatus.REVOKED,
    ])
    .describe('Invitation lifecycle state, such as PENDING, ACCEPTED, REVOKED, or EXPIRED.'),
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
    status: z
      .enum([
        InvitationStatus.PENDING,
        InvitationStatus.ACCEPTED,
        InvitationStatus.EXPIRED,
        InvitationStatus.REVOKED,
      ])
      .describe('Current invitation lifecycle state.'),
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
  firstName: z.string().optional().describe('First name shown for the member activity event when available.'),
  lastName: z.string().optional().describe('Last name shown for the member activity event when available.'),
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

/**
 * Audit-log category — mirrors the AuditCategory union in the service layer
 * (`packages/core-api/src/modules/leagues/audit-service.ts`). Defined here so
 * frontend consumers get a typed enum on the wire.
 */
export const LeagueAuditCategorySchema = z
  .enum([
    'LEAGUE',
    'CONTEST',
    'DRAFT',
    'SCORING',
    'PAYOUT',
    'MEMBER',
    'COMMUNICATION',
  ])
  .describe('Audit-log entry category — broad classification of the action that produced this entry.');
export type LeagueAuditCategory = z.infer<typeof LeagueAuditCategorySchema>;

/**
 * Commissioner audit-log entry. Replaces the previous `JsonObjectSchema`
 * passthrough (pool-master-rop.14.1) — every field except the opaque
 * before/after snapshots is now typed at the wire boundary so frontend
 * consumers compile against the real shape rather than `Record<string, unknown>`.
 *
 * `beforeState` and `afterState` are intentionally opaque: they hold snapshots
 * of arbitrary domain entities depending on the action category (a league
 * record vs a contest record vs a member record etc.). Typing them per
 * category would require a tagged-union the audit log doesn't currently
 * carry; for now keep them as opaque records and document the design intent
 * in the description. The substrate redesign in pool-master-rop.78 may
 * revisit this — see audit doc section 2.3.
 */
export const LeagueAuditEntryDtoSchema = z
  .object({
    id: z.string().describe('Audit-log entry id.'),
    leagueId: z.string().describe('League this entry belongs to.'),
    contestId: z
      .string()
      .optional()
      .describe('Contest this entry references when the action is contest-scoped.'),
    actorId: z.string().describe('User id of the commissioner / actor that performed the action.'),
    action: z.string().describe('Action verb in dotted form (e.g., "league.member.role.changed").'),
    category: LeagueAuditCategorySchema,
    description: z.string().describe('Human-readable description of what happened.'),
    beforeState: JsonObjectSchema
      .optional()
      .describe(
        'Opaque snapshot of relevant entity state BEFORE the action. Shape varies by category; treat as audit data, not as a typed contract.',
      ),
    afterState: JsonObjectSchema
      .optional()
      .describe(
        'Opaque snapshot of relevant entity state AFTER the action. Shape varies by category; treat as audit data, not as a typed contract.',
      ),
    reason: z
      .string()
      .optional()
      .describe('Optional human-supplied reason / justification for the action.'),
    ipAddress: z
      .string()
      .optional()
      .describe('IP address from which the action originated, when available.'),
    createdAt: DateTimeSchema.describe('When the audit entry was recorded.'),
  })
  .describe('Commissioner audit-log entry.');
export type LeagueAuditEntryDto = z.infer<typeof LeagueAuditEntryDtoSchema>;

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
