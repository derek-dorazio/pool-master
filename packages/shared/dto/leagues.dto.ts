/**
 * League DTOs — request/response schemas for league endpoints.
 */
import { z } from 'zod';

// --- Requests ---

export const CreateLeagueRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']),
  maxMembers: z.number().int().min(2).max(1000).optional(),
  sport: z.string().optional(),
});
export type CreateLeagueRequest = z.infer<typeof CreateLeagueRequestSchema>;

export const UpdateLeagueRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']).optional(),
  maxMembers: z.number().int().min(2).max(1000).optional(),
});
export type UpdateLeagueRequest = z.infer<typeof UpdateLeagueRequestSchema>;

// --- Response Sub-schemas ---

export const LeagueSummaryDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  visibility: z.string(),
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
