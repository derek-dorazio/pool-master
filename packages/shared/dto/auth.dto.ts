/**
 * Auth DTOs — request/response schemas for authentication endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { EmailInputSchema, SuccessSchema } from './common.dto';
import { UserDtoSchema } from './users.dto';

// --- Requests ---

export const RegisterRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^\S+$/, 'Username cannot contain spaces')
    .describe('Unique login identifier for the account. This may be email-shaped, but it remains distinct from the contact email field.'),
  email: EmailInputSchema.describe('Primary contact email address for the user account.'),
  password: z
    .string()
    .min(8)
    .max(128)
    .describe('Plaintext password chosen during registration.'),
  firstName: z
    .string()
    .min(1)
    .max(100)
    .describe('First name captured for the account profile.'),
  lastName: z
    .string()
    .min(1)
    .max(100)
    .describe('Last name captured for the account profile.'),
}).describe('Create-account payload for a new username/email/password user.');
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('Username or email used to sign in to an existing account.'),
  password: z.string().describe('Existing password for the account.'),
}).describe('Login payload for an existing username-or-email/password account.');
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

// --- Response Sub-schemas ---

export const AuthTokensDtoSchema = z.object({
  accessToken: z.string().describe('Short-lived bearer token used for authenticated API requests.'),
  refreshToken: z.string().describe('Longer-lived token that can be exchanged for a fresh access token.'),
  csrfToken: z.string().describe('Anti-CSRF token that must be echoed on state-changing browser requests.'),
  expiresIn: z.number().describe('Access-token lifetime in seconds from the time it was issued.'),
}).describe('Authentication token bundle returned after login or registration.');
export type AuthTokensDto = z.infer<typeof AuthTokensDtoSchema>;

// --- Responses ---

export const AuthResponseSchema = z.object({
  user: UserDtoSchema,
  tokens: AuthTokensDtoSchema,
}).describe('Successful authentication response returned after registration or login.');
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// #202 step 3.4 — `MeResponse` is gone with `GET /auth/me`. Reading a user is one operation,
// `GET /users/:userId`, whose `me` resolves to the caller; it returns `UserResponse`.

// #206 — no `sessionId`. The session correlation id stays server-side in the JWT's
// `sid` claim; the browser never receives it and never needs to, because the only
// consumer was the client logger and the ingest route now reads it from the token.
export const TokenRefreshResponseSchema = AuthTokensDtoSchema.describe(
  'Token refresh response carrying the rotated access, refresh and CSRF tokens.',
);
export type TokenRefreshResponse = z.infer<typeof TokenRefreshResponseSchema>;

export const LogoutResponseSchema = SuccessSchema;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
// Only what auth/routes.ts serves. RefreshRequestSchema, LogoutRequestSchema and
// LogoutResponseSchema are not referenced by any route, so registering them would
// publish components nothing serves (check 2).
//
// `UserDto` itself is registered by users.dto.ts, which owns it as of #202 step 3.4 — it
// was declared here as `UserProfileDto`, under a name that read as a view of a user rather
// than the user, in a module that is only one of its callers.
registerSchema('AuthTokensDto', AuthTokensDtoSchema);
registerSchema('RegisterRequest', RegisterRequestSchema);
registerSchema('LoginRequest', LoginRequestSchema);
registerSchema('AuthResponse', AuthResponseSchema);
registerSchema('TokenRefreshResponse', TokenRefreshResponseSchema);
