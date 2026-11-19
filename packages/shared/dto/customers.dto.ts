/**
 * Customers DTOs (#1882): the root admin's grids of every league and every user on the platform.
 * Each list is every row, never paged or searched on the server; the grid filters on the client.
 */
import { z } from 'zod';
import { LeaguePlan } from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';
import { registerSchema } from './schema-registry';

export const CustomerLeagueOwnerDtoSchema = z.object({
  userId: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
}).describe('The league\'s longest-serving active commissioner: the one who created it, unless they stepped down.');
export type CustomerLeagueOwnerDto = z.infer<typeof CustomerLeagueOwnerDtoSchema>;

export const CustomerLeagueDtoSchema = z.object({
  id: z.uuid(),
  leagueCode: z.string().describe('The league\'s code, its web address.'),
  name: z.string(),
  isActive: z.boolean().describe('False for a league a root admin inactivated: read-only outside its lifecycle actions.'),
  plan: z.enum(LeaguePlan).describe('The league\'s plan: FREE, PRO, PREMIUM or PLATINUM.'),
  owner: CustomerLeagueOwnerDtoSchema.nullable().describe('Null when the league has no active commissioner.'),
  memberCount: z.number().int().describe('Active members.'),
  activeContestCount: z.number().int().describe('Open and live contests. Contests still being set up are not counted.'),
  previewEndsAt: DateTimeSchema.nullable().describe('When the league\'s gifted plan (the Premium preview) ends; null once it has ended. Extend it with extendLeaguePlanRenewal.'),
  createdAt: DateTimeSchema,
}).describe('One league on the root admin\'s Customers › Leagues grid.');
export type CustomerLeagueDto = z.infer<typeof CustomerLeagueDtoSchema>;

export const CustomerLeagueListResponseSchema = z.object({
  leagues: z.array(CustomerLeagueDtoSchema).describe('Every league, active or not, by name. Never paged.'),
}).describe('Every league on the platform, for the Customers › Leagues grid.');
export type CustomerLeagueListResponse = z.infer<typeof CustomerLeagueListResponseSchema>;

export const CustomerUserLeagueDtoSchema = z.object({
  id: z.uuid(),
  leagueCode: z.string(),
  name: z.string(),
}).describe('A league the user is an active member of.');
export type CustomerUserLeagueDto = z.infer<typeof CustomerUserLeagueDtoSchema>;

export const CustomerUserDtoSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  username: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  isRootAdmin: z.boolean().describe('Root admin (true) or member (false). Change it with setUserRootAdmin.'),
  isActive: z.boolean().describe('False for a deactivated account: it is signed out and blocked until reactivated.'),
  leagues: z.array(CustomerUserLeagueDtoSchema).describe('The leagues the user is an active member of, by name. Its length is the user\'s league count.'),
  joinedAt: DateTimeSchema.describe('When the account was created.'),
  lastSignInAt: DateTimeSchema.nullable().describe('When the user last signed in, signed up or was given a session. Null if they have not since sign-ins were first recorded.'),
}).describe('One user on the root admin\'s Customers › Users grid.');
export type CustomerUserDto = z.infer<typeof CustomerUserDtoSchema>;

export const CustomerUserListResponseSchema = z.object({
  users: z.array(CustomerUserDtoSchema).describe('Every user, active or not, by last then first name. Never paged.'),
}).describe('Every user on the platform, for the Customers › Users grid.');
export type CustomerUserListResponse = z.infer<typeof CustomerUserListResponseSchema>;

registerSchema('CustomerLeagueOwnerDto', CustomerLeagueOwnerDtoSchema);
registerSchema('CustomerLeagueDto', CustomerLeagueDtoSchema);
registerSchema('CustomerLeagueListResponse', CustomerLeagueListResponseSchema);
registerSchema('CustomerUserLeagueDto', CustomerUserLeagueDtoSchema);
registerSchema('CustomerUserDto', CustomerUserDtoSchema);
registerSchema('CustomerUserListResponse', CustomerUserListResponseSchema);
