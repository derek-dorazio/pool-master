import { z } from 'zod';
import { TeamIconKey as TeamIconKeyEnum, type TeamIconKey } from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';

const TeamIconKeyValues = Object.values(TeamIconKeyEnum) as [TeamIconKey, ...TeamIconKey[]];

export const CreateSquadRequestSchema = z.object({
  name: z.string().min(1).max(100).optional().describe('Squad display name.'),
  iconKey: z.enum(TeamIconKeyValues).optional().describe('Selected built-in team icon key from the curated PoolMaster team icon catalog.'),
}).describe('Request payload for creating a squad within a league.');
export type CreateSquadRequest = z.infer<typeof CreateSquadRequestSchema>;

export const UpdateSquadRequestSchema = z.object({
  name: z.string().min(1).max(100).optional().describe('Updated squad display name.'),
  iconKey: z.enum(TeamIconKeyValues).optional().describe('Updated built-in team icon key from the curated PoolMaster team icon catalog.'),
}).describe('Patch payload for updating a squad.');
export type UpdateSquadRequest = z.infer<typeof UpdateSquadRequestSchema>;

export const AddSquadMemberRequestSchema = z.object({
  userId: z.string().uuid().describe('User to add as an owner of the team.'),
}).describe('Request payload for adding a user to a squad.');
export type AddSquadMemberRequest = z.infer<typeof AddSquadMemberRequestSchema>;

export const SquadMembershipDtoSchema = z.object({
  id: z.string().uuid(),
  squadId: z.string().uuid(),
  leagueId: z.string().uuid(),
  userId: z.string().uuid(),
  firstName: z.string().optional().describe('First name for the squad member.'),
  lastName: z.string().optional().describe('Last name for the squad member.'),
  status: z.enum(['ACTIVE', 'INACTIVE']).describe('Squad membership status.'),
  joinedAt: DateTimeSchema.describe('When the user joined the squad.'),
  createdAt: DateTimeSchema.describe('When the squad membership record was created.'),
  updatedAt: DateTimeSchema.describe('When the squad membership record was last updated.'),
}).describe('Squad membership summary.');
export type SquadMembershipDto = z.infer<typeof SquadMembershipDtoSchema>;

export const SquadDtoSchema = z.object({
  id: z.string().uuid(),
  leagueId: z.string().uuid(),
  createdBy: z.string().uuid(),
  name: z.string().describe('Squad display name.'),
  iconKey: z.enum(TeamIconKeyValues).describe('Selected built-in team icon key from the curated PoolMaster team icon catalog.'),
  status: z.enum(['ACTIVE', 'INACTIVE']).describe('Current squad lifecycle state.'),
  memberCount: z.number().int().describe('Number of memberships attached to the squad.'),
  createdAt: DateTimeSchema.describe('When the squad was created.'),
  updatedAt: DateTimeSchema.describe('When the squad was last updated.'),
  members: z.array(SquadMembershipDtoSchema).optional().describe('Optional expanded squad membership list.'),
}).describe('Squad detail returned from squad-management APIs.');
export type SquadDto = z.infer<typeof SquadDtoSchema>;

export const SquadResponseSchema = z.object({
  squad: SquadDtoSchema,
}).describe('Single-squad response.');
export type SquadResponse = z.infer<typeof SquadResponseSchema>;

export const SquadListResponseSchema = z.object({
  squads: z.array(SquadDtoSchema),
}).describe('Squad-list response.');
export type SquadListResponse = z.infer<typeof SquadListResponseSchema>;

export const SquadMembershipResponseSchema = z.object({
  membership: SquadMembershipDtoSchema,
}).describe('Single squad-membership response.');
export type SquadMembershipResponse = z.infer<typeof SquadMembershipResponseSchema>;
