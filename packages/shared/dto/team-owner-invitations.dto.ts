import { z } from 'zod';
import {
  LeagueRole,
  SquadOwnerInvitationStatus,
  TeamIconKey as TeamIconKeyEnum,
  type TeamIconKey,
} from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';

const TeamIconKeyValues = Object.values(TeamIconKeyEnum) as [TeamIconKey, ...TeamIconKey[]];

export const CreateSquadOwnerInvitationRequestSchema = z.object({
  email: z.string().email().describe('Email address for the intended co-owner.'),
}).describe('Request payload for inviting an additional co-owner to a team.');
export type CreateSquadOwnerInvitationRequest = z.infer<
  typeof CreateSquadOwnerInvitationRequestSchema
>;

export const ReplaceSquadOwnerRequestSchema = z.object({
  email: z.string().email().describe('Email address for the replacement owner.'),
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
