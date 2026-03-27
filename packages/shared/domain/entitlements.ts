/**
 * Plan entitlements — Zod schema and TypeScript types for the billing
 * entitlement system. Used by both backend (EntitlementService) and
 * clients (feature gating UI).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Plan entitlements schema
// ---------------------------------------------------------------------------

export const PlanEntitlementsSchema = z.object({
  max_leagues: z.number(),                    // -1 = unlimited
  max_members_per_league: z.number(),
  max_contests_per_season: z.number(),
  allowed_sports: z.union([z.array(z.string()), z.literal('ALL')]),
  allowed_draft_types: z.union([z.array(z.string()), z.literal('ALL')]),
  allowed_draft_modes: z.union([z.array(z.string()), z.literal('ALL')]),
  real_time_leaderboard: z.boolean(),
  custom_scoring: z.boolean(),
  history_seasons: z.number(),
  analytics_tier: z.enum(['NONE', 'BASIC', 'FULL']),
  branding: z.enum(['NONE', 'LOGO', 'FULL']),
  intermediate_prizes: z.boolean(),
  api_access: z.boolean(),
  support_tier: z.enum(['COMMUNITY', 'EMAIL', 'EMAIL_CHAT', 'DEDICATED']),
});

export type PlanEntitlements = z.infer<typeof PlanEntitlementsSchema>;

// ---------------------------------------------------------------------------
// Entitlement keys — the string identifiers used to check access
// ---------------------------------------------------------------------------

export type EntitlementKey =
  | 'league.create'
  | 'league.member.add'
  | 'contest.create'
  | 'sport.access'
  | 'draft.type'
  | 'draft.mode'
  | 'leaderboard.realtime'
  | 'scoring.custom'
  | 'history.access'
  | 'analytics.access'
  | 'branding.custom'
  | 'prizes.intermediate'
  | 'api.access';

// ---------------------------------------------------------------------------
// Entitlement check result
// ---------------------------------------------------------------------------

export interface EntitlementResult {
  entitled: boolean;
  reason?: string;
  currentUsage?: number;
  limit?: number;
  upgradePlan?: string;
}

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

export type UsageResource = 'LEAGUES' | 'MEMBERS' | 'CONTESTS';

export interface UsageResult {
  resource: UsageResource;
  current: number;
  limit: number;
  percentage: number;
}
