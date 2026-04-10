/**
 * Auth DTOs — request/response schemas for authentication endpoints.
 */
import { z } from 'zod';
import { SuccessSchema } from './common.dto';
import { ErrorEnvelopeSchema } from './errors.dto';

// --- Requests ---

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().optional(),
}).optional();
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const LogoutRequestSchema = z.object({
  refreshToken: z.string().optional(),
}).optional();
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const OAuthCallbackRequestSchema = z.object({
  code: z.string(),
  state: z.string(),
});
export type OAuthCallbackRequest = z.infer<typeof OAuthCallbackRequestSchema>;

// --- Response Sub-schemas ---

export const AuthTokensDtoSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  csrfToken: z.string(),
  expiresIn: z.number(),
});
export type AuthTokensDto = z.infer<typeof AuthTokensDtoSchema>;

export const UserProfileDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  isRootAdmin: z.boolean(),
  authProvider: z.enum(['email', 'google', 'apple']).optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  avatarUrl: z.string().nullable().optional(),
  createdAt: z.string().datetime().optional(),
});
export type UserProfileDto = z.infer<typeof UserProfileDtoSchema>;

// --- Responses ---

export const AuthResponseSchema = z.object({
  user: UserProfileDtoSchema,
  tokens: AuthTokensDtoSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const MeResponseSchema = z.object({
  user: UserProfileDtoSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const TokenRefreshResponseSchema = AuthTokensDtoSchema;
export type TokenRefreshResponse = AuthTokensDto;

export const LogoutResponseSchema = SuccessSchema;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

export const ForgotPasswordResponseSchema = z.object({
  message: z.string(),
});
export type ForgotPasswordResponse = z.infer<typeof ForgotPasswordResponseSchema>;

export const OAuthCallbackResponseSchema = ErrorEnvelopeSchema;
export type OAuthCallbackResponse = z.infer<typeof OAuthCallbackResponseSchema>;
