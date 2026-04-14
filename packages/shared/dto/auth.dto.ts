/**
 * Auth DTOs — request/response schemas for authentication endpoints.
 */
import { z } from 'zod';
import { SuccessSchema } from './common.dto';
import { ErrorEnvelopeSchema } from './errors.dto';

// --- Requests ---

export const RegisterRequestSchema = z.object({
  email: z.string().email().describe('Email address used as the account sign-in identifier.'),
  password: z
    .string()
    .min(8)
    .max(128)
    .describe('Plaintext password chosen during registration.'),
  displayName: z
    .string()
    .min(1)
    .max(100)
    .describe('Full display name shown across the product after account creation.'),
}).describe('Create-account payload for a new email/password user.');
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email().describe('Email address previously used to register the account.'),
  password: z.string().describe('Existing password for the account.'),
}).describe('Login payload for an existing email/password account.');
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z
    .string()
    .optional()
    .describe('Optional refresh token override when the client is not relying on the refresh cookie.'),
}).optional().describe('Optional token-refresh payload. Normally omitted when the refresh cookie is present.');
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const LogoutRequestSchema = z.object({
  refreshToken: z
    .string()
    .optional()
    .describe('Optional refresh token override when the client is not relying on the refresh cookie.'),
}).optional().describe('Optional logout payload. Normally omitted when the refresh cookie is present.');
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email().describe('Email address that should receive password-reset instructions.'),
}).describe('Password-reset initiation payload.');
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const OAuthCallbackRequestSchema = z.object({
  code: z.string().describe('Authorization code returned by the upstream OAuth provider.'),
  state: z.string().describe('Opaque anti-forgery state value returned from the OAuth initiation step.'),
}).describe('OAuth callback payload passed back from a provider integration.');
export type OAuthCallbackRequest = z.infer<typeof OAuthCallbackRequestSchema>;

// --- Response Sub-schemas ---

export const AuthTokensDtoSchema = z.object({
  accessToken: z.string().describe('Short-lived bearer token used for authenticated API requests.'),
  refreshToken: z.string().describe('Longer-lived token that can be exchanged for a fresh access token.'),
  csrfToken: z.string().describe('Anti-CSRF token that must be echoed on state-changing browser requests.'),
  expiresIn: z.number().describe('Access-token lifetime in seconds from the time it was issued.'),
}).describe('Authentication token bundle returned after login or registration.');
export type AuthTokensDto = z.infer<typeof AuthTokensDtoSchema>;

export const UserProfileDtoSchema = z.object({
  id: z.string().describe('Stable user identifier.'),
  email: z.string().describe('Primary email address for the user account.'),
  displayName: z.string().describe('Name shown in league, contest, and profile surfaces.'),
  isActive: z
    .boolean()
    .describe('Whether the account is currently active for normal sign-in and product usage.'),
  isRootAdmin: z.boolean().describe('Whether the user has platform-level root-admin access.'),
  authProvider: z
    .enum(['email', 'google', 'apple'])
    .optional()
    .describe('Authentication provider used for the account when known.'),
  timezone: z.string().optional().describe('Preferred IANA timezone for user-facing scheduling and reminders.'),
  locale: z.string().optional().describe('Preferred locale for formatting and localized copy.'),
  avatarUrl: z.string().nullable().optional().describe('Optional avatar image URL for profile and social surfaces.'),
  createdAt: z.string().datetime().optional().describe('Account creation timestamp in ISO 8601 format.'),
}).describe('Frontend-facing user profile summary derived from the authenticated account.');
export type UserProfileDto = z.infer<typeof UserProfileDtoSchema>;

// --- Responses ---

export const AuthResponseSchema = z.object({
  user: UserProfileDtoSchema,
  tokens: AuthTokensDtoSchema,
}).describe('Successful authentication response returned after registration or login.');
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const MeResponseSchema = z.object({
  user: UserProfileDtoSchema,
}).describe('Authenticated current-user profile response.');
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const TokenRefreshResponseSchema = AuthTokensDtoSchema;
export type TokenRefreshResponse = AuthTokensDto;

export const LogoutResponseSchema = SuccessSchema;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

export const ForgotPasswordResponseSchema = z.object({
  message: z.string().describe('User-safe confirmation message for the password-reset request.'),
}).describe('Password-reset initiation acknowledgement.');
export type ForgotPasswordResponse = z.infer<typeof ForgotPasswordResponseSchema>;

export const OAuthCallbackResponseSchema = ErrorEnvelopeSchema;
export type OAuthCallbackResponse = z.infer<typeof OAuthCallbackResponseSchema>;
