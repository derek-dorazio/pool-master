/**
 * User DTOs — the canonical `User` shape (#202 step 3.4).
 *
 * `UserDto` was `UserProfileDto`, declared inside `auth.dto.ts`. Two things were wrong with
 * that. The name said "profile", which reads as a *view* of a user rather than the user — and
 * a view is exactly what invites a second one (`AdminTeamOwnerSummaryDto` was that second
 * one, a userId plus two name fields). And the home said "auth", which is one caller: the
 * league member roster, the squad roster and every root-admin user surface all return the
 * same object and had no reason to import it from the authentication module.
 *
 * One object, one shape, one module. `auth.dto.ts`, `account.dto.ts` and `admin.dto.ts` all
 * reference this schema rather than restating any part of it.
 *
 * **No viewer context lives here.** Access rule A8: the requester's relationship to what they
 * are reading travels once per league, not as fields on the entity. `UserDetailResponse`'s
 * `viewerAuthority` block is gone for that reason.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { AuthProvider, DateFormat, TimeFormat } from '@poolmaster/shared/domain';

export const UserDtoSchema = z.object({
  id: z.string().describe('Stable user identifier.'),
  email: z.string().describe('Primary email address for the user account.'),
  username: z.string().describe('Unique login identifier for the account.'),
  firstName: z.string().describe('First name shown in account and member-management surfaces.'),
  lastName: z.string().describe('Last name shown in account and member-management surfaces.'),
  isActive: z
    .boolean()
    .describe('Whether the account is currently active for normal sign-in and product usage.'),
  isRootAdmin: z.boolean().describe('Whether the user has platform-level root-admin access.'),
  authProvider: z
    .enum([AuthProvider.EMAIL, AuthProvider.GOOGLE, AuthProvider.APPLE])
    .optional()
    .describe('Authentication provider used for the account when known.'),
  timezone: z.string().optional().describe('Preferred IANA timezone for user-facing scheduling and reminders.'),
  locale: z.string().optional().describe('Preferred locale for formatting and localized copy.'),
  timeFormat: z
    .enum([TimeFormat.TWELVE_HOUR, TimeFormat.TWENTY_FOUR_HOUR])
    .optional()
    .describe('Preferred clock display used in account and scheduling surfaces.'),
  dateFormat: z
    .enum([DateFormat.MDY, DateFormat.DMY, DateFormat.YMD])
    .optional()
    .describe('Preferred date display format used in account and scheduling surfaces.'),
  createdAt: z.string().datetime().optional().describe('Account creation timestamp in ISO 8601 format.'),
}).describe('A user account. The canonical User shape, returned wherever a user is read — the authenticated caller, a league or squad peer, or a root-admin management row.');
export type UserDto = z.infer<typeof UserDtoSchema>;

export const UserResponseSchema = z.object({
  user: UserDtoSchema,
}).describe('Single-user response.');
export type UserResponse = z.infer<typeof UserResponseSchema>;

// #202 — not paged (§16), and named for its entity like LeagueListResponse and
// SquadListResponse rather than the generic `items`/`total` envelope it used to share with
// the audit and error-log surfaces.
export const UserListResponseSchema = z.object({
  users: z.array(UserDtoSchema),
}).describe('User-list response.');
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('UserDto', UserDtoSchema);
registerSchema('UserResponse', UserResponseSchema);
registerSchema('UserListResponse', UserListResponseSchema);
