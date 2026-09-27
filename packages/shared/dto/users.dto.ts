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
import { SuccessSchema } from './common.dto';

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

// --- Requests -----------------------------------------------------------------
// #202 step 3.4 — these were `account.dto.ts`'s `Account*Request` schemas, which named the
// caller rather than the object. Every one of them is a payload for an operation on a User;
// who is allowed to send it is the route's business, not the schema's. `account.dto.ts` is
// deleted with them.

export const UserProfileUpdateRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .describe('Updated primary contact email address.'),
  firstName: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('Updated first name.'),
  lastName: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('Updated last name.'),
}).describe("Profile update payload. Sent by the user themselves or by a root admin (access rule A6).");
export type UserProfileUpdateRequest = z.infer<typeof UserProfileUpdateRequestSchema>;

export const UserUsernameUpdateRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^\S+$/, 'Username cannot contain spaces')
    .describe('Updated unique login username.'),
}).describe('Username update payload.');
export type UserUsernameUpdateRequest = z.infer<typeof UserUsernameUpdateRequestSchema>;

export const UserPreferencesUpdateRequestSchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .nullable()
    .optional()
    .describe('Preferred IANA timezone. Omit to leave unchanged; null to clear it.'),
  locale: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .nullable()
    .optional()
    .describe('Preferred locale. Omit to leave unchanged; null to clear it.'),
  timeFormat: z
    .enum([TimeFormat.TWELVE_HOUR, TimeFormat.TWENTY_FOUR_HOUR])
    .nullable()
    .optional()
    .describe('Preferred clock display format. Omit to leave unchanged; null to clear it.'),
  dateFormat: z
    .enum([DateFormat.MDY, DateFormat.DMY, DateFormat.YMD])
    .nullable()
    .optional()
    .describe('Preferred date display format. Omit to leave unchanged; null to clear it.'),
}).describe('Preferences update payload. Omitted fields are untouched; null clears a field.');
export type UserPreferencesUpdateRequest = z.infer<typeof UserPreferencesUpdateRequestSchema>;

export const UserPasswordChangeRequestSchema = z.object({
  currentPassword: z
    .string()
    .min(1)
    .max(128)
    .describe('Existing password, which must match before the password can be changed.'),
  newPassword: z
    .string()
    .min(8)
    .max(128)
    .describe('New password to persist for future sign-in attempts.'),
  confirmNewPassword: z
    .string()
    .min(8)
    .max(128)
    .describe('Repeat of the new password to guard against confirmation mistakes.'),
}).describe('Password-change payload. Self only, because it requires the current password (A6).');
export type UserPasswordChangeRequest = z.infer<typeof UserPasswordChangeRequestSchema>;

export const UserResetPasswordRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional().describe('Optional human reason captured in the root-admin audit log.'),
}).describe('Password-reset payload. Root admin only, and distinct from a change by subject rather than by precondition.');
export type UserResetPasswordRequest = z.infer<typeof UserResetPasswordRequestSchema>;

export const UserResetPasswordResponseSchema = z.object({
  temporaryPassword: z.string().min(8).describe('Temporary password to relay to the user. Existing sessions are revoked and the user should change this after signing in.'),
}).describe('Password-reset response.');
export type UserResetPasswordResponse = z.infer<typeof UserResetPasswordResponseSchema>;

export const UserDisableRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional().describe('Optional human reason captured in the root-admin audit log when an admin disables somebody else.'),
}).describe('Disable payload. The reason is optional because self-inactivation has nobody to explain itself to.');
export type UserDisableRequest = z.infer<typeof UserDisableRequestSchema>;

export const UserDeleteRequestSchema = z.object({
  email: z
    .string()
    .email()
    .describe('Exact email confirmation required before permanently deleting the inactive account.'),
  reason: z.string().trim().min(1).max(500).optional().describe('Optional human reason captured in the root-admin audit log.'),
}).describe('Permanent-delete confirmation payload.');
export type UserDeleteRequest = z.infer<typeof UserDeleteRequestSchema>;

export const SetUserRootAdminRequestSchema = z.object({
  isRootAdmin: z.boolean().describe('Whether the target user should hold the platform-level root-admin role after the change.'),
  reason: z.string().trim().min(1).max(500).optional().describe('Optional human reason captured in the root-admin audit log.'),
}).describe('Root-admin role-change payload.');
export type SetUserRootAdminRequest = z.infer<typeof SetUserRootAdminRequestSchema>;

export const RevokeUserSessionsResponseSchema = z.object({
  revokedCount: z.number().int().describe('How many live sessions were revoked.'),
}).describe('Session-revocation response.');
export type RevokeUserSessionsResponse = z.infer<typeof RevokeUserSessionsResponseSchema>;

export const UserSuccessResponseSchema = SuccessSchema.describe(
  'Minimal success response for user operations that return no entity.',
);
export type UserSuccessResponse = z.infer<typeof UserSuccessResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('UserDto', UserDtoSchema);
registerSchema('UserResponse', UserResponseSchema);
registerSchema('UserListResponse', UserListResponseSchema);
registerSchema('UserProfileUpdateRequest', UserProfileUpdateRequestSchema);
registerSchema('UserUsernameUpdateRequest', UserUsernameUpdateRequestSchema);
registerSchema('UserPreferencesUpdateRequest', UserPreferencesUpdateRequestSchema);
registerSchema('UserPasswordChangeRequest', UserPasswordChangeRequestSchema);
registerSchema('UserResetPasswordRequest', UserResetPasswordRequestSchema);
registerSchema('UserResetPasswordResponse', UserResetPasswordResponseSchema);
registerSchema('UserDisableRequest', UserDisableRequestSchema);
registerSchema('UserDeleteRequest', UserDeleteRequestSchema);
registerSchema('SetUserRootAdminRequest', SetUserRootAdminRequestSchema);
registerSchema('RevokeUserSessionsResponse', RevokeUserSessionsResponseSchema);
