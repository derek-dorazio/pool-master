/**
 * Auth DTOs — request/response schemas for authentication endpoints.
 */
import { z } from 'zod';

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
  refreshToken: z.string(),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const LogoutRequestSchema = z.object({
  refreshToken: z.string(),
});
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

// --- Response Sub-schemas ---

export const AuthTokensDtoSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});
export type AuthTokensDto = z.infer<typeof AuthTokensDtoSchema>;

export const UserProfileDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  tenantId: z.string().optional(),
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
