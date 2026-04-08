import { z } from 'zod';
import { DateTimeSchema } from './common.dto';

export const CreateSquadRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  iconUrl: z.string().url().max(500).optional(),
});
export type CreateSquadRequest = z.infer<typeof CreateSquadRequestSchema>;

export const UpdateSquadRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  iconUrl: z.string().url().max(500).optional(),
});
export type UpdateSquadRequest = z.infer<typeof UpdateSquadRequestSchema>;

export const AddSquadMemberRequestSchema = z.object({
  userId: z.string().uuid(),
});
export type AddSquadMemberRequest = z.infer<typeof AddSquadMemberRequestSchema>;

export const SquadMembershipDtoSchema = z.object({
  id: z.string().uuid(),
  squadId: z.string().uuid(),
  leagueId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  joinedAt: DateTimeSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});
export type SquadMembershipDto = z.infer<typeof SquadMembershipDtoSchema>;

export const SquadDtoSchema = z.object({
  id: z.string().uuid(),
  leagueId: z.string().uuid(),
  createdBy: z.string().uuid(),
  name: z.string(),
  iconUrl: z.string().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  memberCount: z.number().int(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  members: z.array(SquadMembershipDtoSchema).optional(),
});
export type SquadDto = z.infer<typeof SquadDtoSchema>;

export const SquadResponseSchema = z.object({
  squad: SquadDtoSchema,
});
export type SquadResponse = z.infer<typeof SquadResponseSchema>;

export const SquadListResponseSchema = z.object({
  squads: z.array(SquadDtoSchema),
});
export type SquadListResponse = z.infer<typeof SquadListResponseSchema>;

export const SquadMembershipResponseSchema = z.object({
  membership: SquadMembershipDtoSchema,
});
export type SquadMembershipResponse = z.infer<typeof SquadMembershipResponseSchema>;
