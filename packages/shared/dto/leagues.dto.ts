/**
 * League DTOs — request/response schemas for league endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  InvitationStatus,
  JoinPolicy,
  InviteType,
  LeagueIconKey,
  LeagueMembershipStatus,
  LeagueRole,
} from '../domain/enums';
import { DateTimeSchema } from './common.dto';
import { ContestDtoSchema } from './contests.dto';
import { SquadMembershipDtoSchema } from './squads.dto';
import { UserDtoSchema } from './users.dto';

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

// #202 — the copy-season request schema is gone with the `copy-season` route.

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

/**
 * A league. The canonical League shape (#202 step 3.4).
 *
 * This was two schemas and five viewer fields. `LeagueDetailDto` was
 * `LeagueSummaryDto.extend({ joinPolicy })` — a pure view variant, and the reason the webapp
 * grew a `toLeagueSummary()` that hand-projected one down to the other field by field. One
 * schema now carries `joinPolicy`.
 *
 * **It carries no viewer context** (access rule A8). Gone: `memberType`,
 * `leagueRelationship` and `isRootAdmin`. Those made the DTO a function of *who asked* —
 * two requesters got different values for the same league, which is not a value of the
 * entity, defeats caching, and was the seed of the admin/member DTO split this pass exists
 * to undo. `isRootAdmin` was the worst of the three: a global property of the User,
 * repeated on every row of every list.
 *
 * The viewer's context arrives once per league, on the league-context call
 * (`LeagueContextResponse`), and once for the leagues list, as `LeagueMembership[]` beside
 * the leagues.
 */
export const LeagueDtoSchema = z.object({
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
  joinPolicy: z
    .enum([JoinPolicy.COMMISSIONER_ONLY, JoinPolicy.LINK_INVITE, JoinPolicy.OPEN])
    .describe('League join policy controlling whether membership comes only through commissioners, shareable invite links, or open enrollment.'),
  createdAt: z.string().datetime().optional().describe('League creation timestamp in ISO 8601 format.'),
}).describe('A league. Returned wherever a league is read — the selector, league home, and root-admin management rows are the same object.');
export type LeagueDto = z.infer<typeof LeagueDtoSchema>;

/**
 * The User↔League edge (#202 step 3.4).
 *
 * `LeagueMemberDto` is gone: it was this edge with three `User` columns flattened onto it
 * (`email`, `firstName`, `lastName`) and the rest of the user dropped, produced by a service
 * with no repository ports doing a raw Prisma join. Two shapes for one edge, and the flat one
 * could not answer "is this member active" or "what is their timezone" without a second call.
 *
 * The edge now **embeds the canonical `UserDto`**, which is what
 * `docs/DOMAIN-OPERATIONS.md` says an edge does: a member reads peer users through the league
 * join, and returns the full object per working rule 3. This is not viewer context — whose
 * league it is does not change who its members are — so A8 does not apply to it.
 */
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
  user: UserDtoSchema.describe('The member, as the canonical UserDto.'),
}).describe('A membership of a user in a league, with the member embedded.');
export type LeagueMembershipDto = z.infer<typeof LeagueMembershipDtoSchema>;

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
  eventType: z.enum(['DRAFT_START', 'CONTEST_START', 'CONTEST_END']).describe('Upcoming event category.'),
}).describe('Upcoming league event summary.');
export type UpcomingEventDto = z.infer<typeof UpcomingEventDtoSchema>;

// --- Responses ---

export const LeagueResponseSchema = z.object({
  league: LeagueDtoSchema,
}).describe('Single-league response.');
export type LeagueResponse = z.infer<typeof LeagueResponseSchema>;

/**
 * The league-context call (#202 step 3.4, access rule A8).
 *
 * This is the ONE response that carries the viewer's relationship to a league, and it carries
 * it as the canonical edges rather than as flags: the viewer's `LeagueMembership` in this
 * league, and their `SquadMembership` in it. The client fetches this once on league selection
 * and holds it for the session, so every league-scoped response after it — squads, members,
 * contests, entries — carries none.
 *
 * `null` for either edge means the viewer has none. A root admin reading a league they do not
 * belong to is the case that produces a null membership.
 */
export const LeagueContextResponseSchema = z.object({
  league: LeagueDtoSchema,
  membership: LeagueMembershipDtoSchema.nullable()
    .describe("The viewer's membership in this league, or null when they have none."),
  squadMembership: SquadMembershipDtoSchema.nullable()
    .describe("The viewer's squad membership within this league, or null when they hold none."),
}).describe("A league together with the viewer's own membership edges in it. Fetched once per league; nothing else repeats this context.");
export type LeagueContextResponse = z.infer<typeof LeagueContextResponseSchema>;

/**
 * The league-list query (#202).
 *
 * `scope` is the operation's scope parameter, and it is **explicit rather than inferred from
 * the caller's role**. `docs/DOMAIN-OPERATIONS.md` said scope would be "resolved from the
 * caller's role", and implementing the collapse showed that cannot work for a root admin:
 * they legitimately need both scopes. The league selector wants the leagues they personally
 * belong to; the management surface wants every league. One request cannot mean both, so the
 * caller says which it wants and authorization decides whether it may.
 *
 * `all` is the unscoped read access rule A1 permits to a root admin only; anything else gets
 * 403. `mine` is the scoped read A2 gives everyone, including a root admin asking about their
 * own memberships.
 */
export const LeagueListQuerySchema = z.object({
  scope: z
    .enum(['mine', 'all'])
    .optional()
    .describe("Which leagues to return: 'mine' (default) for the leagues the caller belongs to, 'all' for every league on the platform. 'all' requires root-admin access."),
  search: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional case-insensitive substring matched against the league name. A filter, never a slice — see §16.'),
  isActive: z
    .boolean()
    .optional()
    .describe('Optional active/inactive filter. Omitted returns both.'),
}).describe('League-list query. Narrows the result; it never pages it.');
export type LeagueListQuery = z.infer<typeof LeagueListQuerySchema>;

/**
 * The leagues list — the one inherently multi-league surface, and so the one exception A8
 * allows. The viewer's relationship differs per league, and the selector must show which of
 * your leagues you run, so the relationship travels as a SET: one `LeagueMembership[]`
 * beside the leagues, not a field repeated on every row.
 */
export const LeagueListResponseSchema = z.object({
  leagues: z.array(LeagueDtoSchema),
  memberships: z.array(LeagueMembershipDtoSchema)
    .describe("The viewer's own memberships across the returned leagues. Empty for a root admin listing leagues they do not belong to."),
}).describe('League-list response, with the viewer\'s memberships once as an array.');
export type LeagueListResponse = z.infer<typeof LeagueListResponseSchema>;

export const LeagueMembersResponseSchema = z.object({
  members: z.array(LeagueMembershipDtoSchema),
}).describe('League-members response. Each member is the membership edge with the user embedded.');
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

/**
 * Commissioner dashboard response. The `league` and `contests` fields are typed against the
 * canonical `LeagueDtoSchema` and `ContestDtoSchema` rather than `JsonObjectSchema`
 * placeholders. It is league-scoped, so it carries no viewer context (A8).
 */
export const LeagueDashboardResponseSchema = z.object({
  league: LeagueDtoSchema.describe('League payload driving the dashboard header.'),
  contests: z.array(ContestDtoSchema).describe('The league\'s contests.'),
  memberCount: z.number().int().describe('Current league member count.'),
  pendingInvites: z.number().int().describe('Current number of pending invitations.'),
  recentMemberActivity: z.array(MemberActivityEventDtoSchema).describe('Recent member activity for the league.'),
  upcomingEvents: z.array(UpcomingEventDtoSchema).describe('Upcoming league events that should be surfaced on the dashboard.'),
}).describe('Commissioner dashboard response.');
export type LeagueDashboardResponse = z.infer<typeof LeagueDashboardResponseSchema>;

export const LeagueBulkOperationResponseSchema = z.object({
  total: z.number().int().min(0).describe('How many rows the import received.'),
  sent: z.number().int().min(0).describe('How many invitations the import created.'),
  failed: z.array(z.object({
    email: z.string().describe('Email address on the row that failed.'),
    reason: z.string().describe('Why the row was not imported.'),
  })).describe('Rows that were not imported, with the reason for each.'),
  duplicates: z.array(z.string()).describe('Email addresses skipped because they already have an invitation to this league.'),
}).describe('Result of a bulk CSV member import.');
export type LeagueBulkOperationResponse = z.infer<typeof LeagueBulkOperationResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
// Each name becomes `components.schemas.<name>` and an importable generated type. There is
// one league shape to import — `LeagueDto` — because #202 step 3.4 collapsed the summary and
// detail variants into it.
registerSchema('CreateLeagueRequest', CreateLeagueRequestSchema);
registerSchema('DeleteLeagueRequest', DeleteLeagueRequestSchema);
registerSchema('UpdateLeagueDetailsRequest', UpdateLeagueDetailsRequestSchema);
registerSchema('UpdateLeagueIconRequest', UpdateLeagueIconRequestSchema);
registerSchema('SendLeagueInvitationsRequest', SendLeagueInvitationsRequestSchema);
registerSchema('GenerateInviteLinkRequest', GenerateInviteLinkRequestSchema);
registerSchema('ChangeLeagueMemberRoleRequest', ChangeLeagueMemberRoleRequestSchema);
registerSchema('AcceptInvitationRequest', AcceptInvitationRequestSchema);
registerSchema('CsvImportRow', CsvImportRowSchema);
registerSchema('ImportLeagueMembersRequest', ImportLeagueMembersRequestSchema);
registerSchema('LeagueListQuery', LeagueListQuerySchema);
registerSchema('LeagueDto', LeagueDtoSchema);
registerSchema('LeagueMembershipDto', LeagueMembershipDtoSchema);
registerSchema('LeagueInvitationDto', LeagueInvitationDtoSchema);
registerSchema('InvitationPreviewResponse', InvitationPreviewResponseSchema);
registerSchema('MemberActivityEventDto', MemberActivityEventDtoSchema);
registerSchema('UpcomingEventDto', UpcomingEventDtoSchema);
registerSchema('LeagueResponse', LeagueResponseSchema);
registerSchema('LeagueContextResponse', LeagueContextResponseSchema);
registerSchema('LeagueListResponse', LeagueListResponseSchema);
registerSchema('LeagueMembersResponse', LeagueMembersResponseSchema);
registerSchema('LeagueMembershipResponse', LeagueMembershipResponseSchema);
registerSchema('SendLeagueInvitationsResponse', SendLeagueInvitationsResponseSchema);
registerSchema('GenerateInviteLinkResponse', GenerateInviteLinkResponseSchema);
registerSchema('LeagueDashboardResponse', LeagueDashboardResponseSchema);
registerSchema('LeagueBulkOperationResponse', LeagueBulkOperationResponseSchema);
