/**
 * League DTOs — request/response schemas for league endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  CupPointsScale,
  EmailMessageStatus,
  EmailSkipReason,
  EventEmailDelivery,
  InvitationStatus,
  InviteType,
  LeagueIconKey,
  LeagueMembershipStatus,
  LeagueRole,
} from '../domain/enums';
import { DateTimeSchema, EmailInputSchema } from './common.dto';
import { SquadMembershipDtoSchema } from './squads.dto';
import { UserDtoSchema } from './users.dto';
import { PlanEntitlementsDtoSchema } from './plans.dto';

/** The curated league icon catalog, shared by the league response and the details update. */
const LeagueIconKeySchema = z.enum([
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
]);

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
  iconKey: LeagueIconKeySchema
    .describe('Built-in league icon from the curated PoolMaster icon catalog. Send the current icon to keep it.'),
}).describe('Commissioner request payload for editing league details while the league remains active. Name, description and icon are replaced together, so a save either applies all three or none.');
export type UpdateLeagueDetailsRequest = z.infer<typeof UpdateLeagueDetailsRequestSchema>;

/** The most places a CUSTOM points table lists; every place after it scores 0. */
export const CUP_CUSTOM_POINTS_MAX_PLACES = 50;
/** The most whole points one place can earn on a CUSTOM table. */
export const CUP_CUSTOM_POINTS_MAX = 1000;

export const UpdateLeagueCupSettingsRequestSchema = z.object({
  cupName: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('The league championship\'s name, shown after its year.'),
  cupPointsScale: z.enum(CupPointsScale).describe('The points table every cup and the championship score on.'),
  cupCustomPoints: z
    .array(z.number().int().min(0).max(CUP_CUSTOM_POINTS_MAX))
    .max(CUP_CUSTOM_POINTS_MAX_PLACES)
    .describe(`CUSTOM's whole points for 1st, 2nd ... (0 to ${CUP_CUSTOM_POINTS_MAX}, at most ${CUP_CUSTOM_POINTS_MAX_PLACES} places). Required, and only allowed, for CUSTOM: 400 CUP_CUSTOM_POINTS_INVALID otherwise. Send [] for every other scale.`),
  hallOfLameVisible: z.boolean().describe('Whether the record book shows its Hall of Lame rows, for the whole league.'),
}).describe('Commissioner request payload for the league\'s championship settings: its name, points table and whether the Hall of Lame shows, replaced together. Cups score on read, so they follow a new table at once; the championship keeps the points each contest earned when it went final, and scores later contests on the new table.');
export type UpdateLeagueCupSettingsRequest = z.infer<typeof UpdateLeagueCupSettingsRequestSchema>;

export const UpdateLeagueEventEmailSettingsRequestSchema = z.object({
  mutedSportLeagueIds: z
    .array(z.uuid())
    .max(200)
    .describe('The sport leagues whose upcoming events the league\'s commissioners are not emailed about; [] for every sport league. A repeated id counts once. 400 SPORT_LEAGUE_NOT_FOUND for an id that is not a sport league.'),
  eventEmailDelivery: z.enum(EventEmailDelivery).describe('PER_EVENT for a "Coming up soon" and a "Ready for contests" email about each event; WEEKLY_DIGEST for one Monday email listing the next two weeks\' events instead.'),
}).describe('Commissioner request payload for how the league\'s commissioners hear about upcoming events (#851): which sport leagues, and one email per event or a weekly digest, replaced together.');
export type UpdateLeagueEventEmailSettingsRequest = z.infer<typeof UpdateLeagueEventEmailSettingsRequestSchema>;

export const SendLeagueInvitationsRequestSchema = z.object({
  emails: z.array(EmailInputSchema).min(1).max(50).describe('Email recipients to invite into the league.'),
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
 * This was two schemas and five viewer fields: `LeagueDetailDto` was a pure view variant of
 * `LeagueSummaryDto`, and the reason the webapp grew a `toLeagueSummary()` that hand-projected
 * one down to the other field by field. One schema now serves both.
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
  iconKey: LeagueIconKeySchema
    .describe('Selected built-in league icon key from the curated PoolMaster icon catalog.'),
  memberCount: z.number().describe('Current number of memberships in the league.'),
  activeContestCount: z.number().describe('Number of currently active contests associated with the league.'),
  createdAt: z.iso.datetime().optional().describe('League creation timestamp in ISO 8601 format.'),
  cupName: z.string().describe('The league championship\'s name, shown after its year: "2026 Big Dawgs Cup".'),
  cupPointsScale: z.enum(CupPointsScale).describe('The points table every cup and the championship score on: STANDARD 100, 80, 65 ... and 5 for every place after 20th; TOP_TEN 25, 18, 15 ... 1; FIELD_BEATEN one point per entry finished behind, plus one; CUSTOM the commissioner\'s list.'),
  cupCustomPoints: z.array(z.number().int()).describe('CUSTOM\'s whole points for 1st, 2nd ...; places past the list score 0. Empty for every other scale.'),
  hallOfLameVisible: z.boolean().describe('Whether the record book shows its Hall of Lame rows: most 2nds, 4ths and last places, and the longest drought. On at creation.'),
  planEntitlements: PlanEntitlementsDtoSchema.describe(
    'The league\'s plan and what it allows now: its caps and features. Premium at creation. The app shows the plan\'s name to commissioners only; members only meet its effects.',
  ),
  planRenewsAt: z.iso.datetime().describe('When the league\'s gifted plan ends: six months after signup, unless a root admin extended it.'),
  mutedSportLeagueIds: z.array(z.uuid()).describe('Sport leagues whose upcoming events the league\'s commissioners are not emailed about ("Coming up soon", "Ready for contests"). Empty, the default: every sport league.'),
  eventEmailDelivery: z.enum(EventEmailDelivery).describe('How the league\'s commissioners hear about upcoming events: PER_EVENT, a "Coming up soon" and a "Ready for contests" email for each event (the default); WEEKLY_DIGEST, one Monday email listing the next two weeks\' events instead.'),
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

export const EmailMessageStatusSchema = z.enum(EmailMessageStatus).describe(
  'Where one email stands: QUEUED waiting to be sent, SENDING being sent, SENT accepted by the mail '
  + 'service, DELIVERED reached the recipient\'s mail server, BOUNCED refused for good by that server, '
  + 'COMPLAINED marked as spam by the recipient, FAILED not sent after every try or rejected by the mail '
  + 'service, SKIPPED not sent (see the skip reason).',
);

export const EmailSkipReasonSchema = z.enum(EmailSkipReason).describe(
  'Why an email was not sent: EMAIL_DISABLED email is switched off, TEMPLATE_DISABLED this kind of '
  + 'email is switched off, NOT_ALLOWED_IN_ENVIRONMENT the address may not be emailed here, SUPPRESSED '
  + 'the address bounced for good or marked an earlier email as spam, OPTED_OUT the recipient turned '
  + 'this kind of email off, NOT_IN_PLAN the league\'s plan does not include this email.',
);

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
  emailStatus: EmailMessageStatusSchema.nullable().describe(
    'Where the latest email of an email invite stands; null for a join link, which has no email.',
  ),
  emailSkipReason: EmailSkipReasonSchema.nullable().describe(
    'Why the latest email of an email invite was not sent; null unless emailStatus is SKIPPED.',
  ),
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
  sent: z.array(LeagueInvitationDtoSchema).describe('Invitations created, each with its email queued or skipped.'),
  skippedMembers: z.array(z.string()).describe('Emails skipped because they already belong to the league.'),
  skippedDuplicates: z.array(z.string()).describe('Emails skipped because they were duplicated in the request or invite set.'),
}).describe('League invitation-send response.');
export type SendLeagueInvitationsResponse = z.infer<typeof SendLeagueInvitationsResponseSchema>;

export const GenerateInviteLinkResponseSchema = z.object({
  invitation: LeagueInvitationDtoSchema,
}).describe('Generated invite-link response.');
export type GenerateInviteLinkResponse = z.infer<typeof GenerateInviteLinkResponseSchema>;

export const ListLeagueInvitationsResponseSchema = z.object({
  invitations: z.array(LeagueInvitationDtoSchema).describe(
    'The league\'s outstanding invitations, newest first: every PENDING invitation (email invites not yet accepted, join links not yet cancelled or used up), plus email invites that went EXPIRED without being accepted. An email invite past its expiresAt stays listed until it is accepted or cancelled; Resend Invite renews it.',
  ),
}).describe('Commissioner list of a league\'s pending invitations.');
export type ListLeagueInvitationsResponse = z.infer<typeof ListLeagueInvitationsResponseSchema>;

export const ResendLeagueInvitationResponseSchema = z.object({
  invitation: LeagueInvitationDtoSchema.describe('The renewed invitation, with its new invite code and expiry.'),
}).describe('Resent email-invitation response.');
export type ResendLeagueInvitationResponse = z.infer<typeof ResendLeagueInvitationResponseSchema>;

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
registerSchema('UpdateLeagueCupSettingsRequest', UpdateLeagueCupSettingsRequestSchema);
registerSchema('UpdateLeagueEventEmailSettingsRequest', UpdateLeagueEventEmailSettingsRequestSchema);
registerSchema('SendLeagueInvitationsRequest', SendLeagueInvitationsRequestSchema);
registerSchema('GenerateInviteLinkRequest', GenerateInviteLinkRequestSchema);
registerSchema('ChangeLeagueMemberRoleRequest', ChangeLeagueMemberRoleRequestSchema);
registerSchema('AcceptInvitationRequest', AcceptInvitationRequestSchema);
registerSchema('CsvImportRow', CsvImportRowSchema);
registerSchema('ImportLeagueMembersRequest', ImportLeagueMembersRequestSchema);
registerSchema('LeagueListQuery', LeagueListQuerySchema);
registerSchema('LeagueDto', LeagueDtoSchema);
registerSchema('LeagueMembershipDto', LeagueMembershipDtoSchema);
registerSchema('EmailMessageStatus', EmailMessageStatusSchema);
registerSchema('EmailSkipReason', EmailSkipReasonSchema);
registerSchema('LeagueInvitationDto', LeagueInvitationDtoSchema);
registerSchema('InvitationPreviewResponse', InvitationPreviewResponseSchema);
registerSchema('LeagueResponse', LeagueResponseSchema);
registerSchema('LeagueContextResponse', LeagueContextResponseSchema);
registerSchema('LeagueListResponse', LeagueListResponseSchema);
registerSchema('LeagueMembersResponse', LeagueMembersResponseSchema);
registerSchema('LeagueMembershipResponse', LeagueMembershipResponseSchema);
registerSchema('SendLeagueInvitationsResponse', SendLeagueInvitationsResponseSchema);
registerSchema('GenerateInviteLinkResponse', GenerateInviteLinkResponseSchema);
registerSchema('ListLeagueInvitationsResponse', ListLeagueInvitationsResponseSchema);
registerSchema('ResendLeagueInvitationResponse', ResendLeagueInvitationResponseSchema);
registerSchema('LeagueBulkOperationResponse', LeagueBulkOperationResponseSchema);
