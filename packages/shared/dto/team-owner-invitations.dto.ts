import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  LeagueRole,
  SquadOwnerInvitationStatus,
  TeamIconKey as TeamIconKeyEnum,
  type TeamIconKey,
} from '@poolmaster/shared/domain';
import { DateTimeSchema, EmailInputSchema } from './common.dto';

const TeamIconKeyValues = Object.values(TeamIconKeyEnum) as [TeamIconKey, ...TeamIconKey[]];

export const CreateSquadOwnerInvitationRequestSchema = z.object({
  email: EmailInputSchema.describe('Email address for the intended co-owner.'),
}).describe('Request payload for inviting an additional co-owner to a team.');
export type CreateSquadOwnerInvitationRequest = z.infer<
  typeof CreateSquadOwnerInvitationRequestSchema
>;

export const ReplaceSquadOwnerRequestSchema = z.object({
  email: EmailInputSchema.describe('Email address for the replacement owner.'),
}).describe('Request payload for replacing an existing active owner on a team.');
export type ReplaceSquadOwnerRequest = z.infer<typeof ReplaceSquadOwnerRequestSchema>;

export const AcceptTeamOwnerInvitationRequestSchema = z.object({
  inviteCode: z.string().min(1).describe('Team-owner invitation code from the invite URL or email.'),
}).describe('Authenticated team-owner invitation acceptance payload.');
export type AcceptTeamOwnerInvitationRequest = z.infer<
  typeof AcceptTeamOwnerInvitationRequestSchema
>;

export const TeamOwnerInvitationDtoSchema = z.object({
  id: z.string().uuid(),
  leagueId: z.string().uuid(),
  squadId: z.string().uuid(),
  email: z.string().email(),
  inviteCode: z.string(),
  status: z.enum([
    SquadOwnerInvitationStatus.PENDING,
    SquadOwnerInvitationStatus.ACCEPTED,
    SquadOwnerInvitationStatus.EXPIRED,
    SquadOwnerInvitationStatus.REVOKED,
  ]),
  invitedBy: z.string().uuid(),
  acceptedBy: z.string().uuid().optional().nullable(),
  acceptedAt: DateTimeSchema.optional().nullable(),
  expiresAt: DateTimeSchema.optional().nullable(),
  replacementForUserId: z.string().uuid().optional().nullable(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  team: z.object({
    id: z.string().uuid(),
    name: z.string(),
    iconKey: z.enum(TeamIconKeyValues),
  }),
}).describe('Pending or historical team-owner invitation record.');
export type TeamOwnerInvitationDto = z.infer<typeof TeamOwnerInvitationDtoSchema>;

export const TeamOwnerInvitationResponseSchema = z.object({
  invitation: TeamOwnerInvitationDtoSchema,
}).describe('Single team-owner invitation response.');
export type TeamOwnerInvitationResponse = z.infer<typeof TeamOwnerInvitationResponseSchema>;

export const TeamOwnerInvitationListResponseSchema = z.object({
  invitations: z.array(TeamOwnerInvitationDtoSchema),
}).describe('League-scoped list of team-owner invitations.');
export type TeamOwnerInvitationListResponse = z.infer<
  typeof TeamOwnerInvitationListResponseSchema
>;

export const TeamOwnerInvitationPreviewResponseSchema = z.object({
  invitation: z.object({
    inviteCode: z.string(),
    status: z.enum([
      SquadOwnerInvitationStatus.PENDING,
      SquadOwnerInvitationStatus.ACCEPTED,
      SquadOwnerInvitationStatus.EXPIRED,
      SquadOwnerInvitationStatus.REVOKED,
    ]),
    league: z.object({
      id: z.string().uuid(),
      leagueCode: z.string(),
      name: z.string(),
    }),
    team: z.object({
      id: z.string().uuid(),
      name: z.string(),
      iconKey: z.enum(TeamIconKeyValues),
    }),
    roleAfterAccept: z
      .enum([LeagueRole.MEMBER])
      .describe('League role applied when the invitation is accepted.'),
  }),
}).describe('Public preview payload for a team-owner invitation.');
export type TeamOwnerInvitationPreviewResponse = z.infer<
  typeof TeamOwnerInvitationPreviewResponseSchema
>;

/**
 * Register and accept a team-owner invitation in one request (#217).
 *
 * The flow for an invited email that has **no PoolMaster account**. `inviteOwner` already handles
 * the other case: when the email belongs to an existing user it provisions them onto the squad
 * immediately and returns the invitation `ACCEPTED`, so there is nothing to accept. The
 * pending-then-accept path exists only for a stranger, and `acceptTeamOwnerInvitation` cannot
 * serve them because it requires an authenticated caller.
 *
 * **There is no `email` field, and that is the design.** The account is created with the address
 * the commissioner invited, taken from the invitation. A squad-owner invitation grants league
 * membership, so honouring whoever completes the flow would let a forwarded link admit an
 * unintended person. Settled with the repo owner: bind to the invited email.
 */
export const RegisterWithTeamOwnerInvitationRequestSchema = z.object({
  inviteCode: z.string().min(1).describe('Invite code from the team-owner invitation URL.'),
  username: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^\S+$/, 'Username cannot contain spaces')
    .describe('Unique login identifier chosen by the invitee. The account email is not chosen here — it is the address the invitation was sent to.'),
  password: z
    .string()
    .min(8)
    .max(128)
    .describe('Plaintext password chosen during registration.'),
  firstName: z
    .string()
    .min(1)
    .max(100)
    .describe('First name captured for the account profile. Also names the invitee on the squad roster.'),
  lastName: z
    .string()
    .min(1)
    .max(100)
    .describe('Last name captured for the account profile.'),
}).describe('Registers a new account against a pending team-owner invitation and accepts it, joining the league and the squad in one request.');
export type RegisterWithTeamOwnerInvitationRequest = z.infer<
  typeof RegisterWithTeamOwnerInvitationRequestSchema
>;

// --- Published contract (#192) -------------------------------------------------
// These shapes are served by BOTH squads/routes.ts and team-invitations/routes.ts, so
// both modules convert together. TeamOwnerInvitationDto is the canonical invitation
// shape; the frontend imports it rather than deriving from a response map.
registerSchema('CreateSquadOwnerInvitationRequest', CreateSquadOwnerInvitationRequestSchema);
registerSchema('ReplaceSquadOwnerRequest', ReplaceSquadOwnerRequestSchema);
registerSchema('AcceptTeamOwnerInvitationRequest', AcceptTeamOwnerInvitationRequestSchema);
registerSchema(
  'RegisterWithTeamOwnerInvitationRequest',
  RegisterWithTeamOwnerInvitationRequestSchema,
);
registerSchema('TeamOwnerInvitationDto', TeamOwnerInvitationDtoSchema);
registerSchema('TeamOwnerInvitationResponse', TeamOwnerInvitationResponseSchema);
registerSchema('TeamOwnerInvitationListResponse', TeamOwnerInvitationListResponseSchema);
registerSchema('TeamOwnerInvitationPreviewResponse', TeamOwnerInvitationPreviewResponseSchema);
