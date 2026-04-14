import { z } from 'zod';
import { DateTimeSchema } from './common.dto';

export const CreateSquadRequestSchema = z.object({
  name: z.string().min(1).max(100).optional().describe('Squad display name.'),
  iconUrl: z.string().url().max(500).optional().describe('Optional squad icon URL.'),
}).describe('Request payload for creating a squad within a league.');
export type CreateSquadRequest = z.infer<typeof CreateSquadRequestSchema>;

export const UpdateSquadRequestSchema = z.object({
  name: z.string().min(1).max(100).optional().describe('Updated squad display name.'),
  iconUrl: z.string().url().max(500).optional().describe('Updated squad icon URL.'),
}).describe('Patch payload for updating a squad.');
export type UpdateSquadRequest = z.infer<typeof UpdateSquadRequestSchema>;

export const AddSquadMemberRequestSchema = z.object({
  userId: z.string().uuid().describe('User to add as a squad co-manager or member.'),
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
  iconUrl: z.string().nullable().optional().describe('Optional squad icon URL.'),
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
