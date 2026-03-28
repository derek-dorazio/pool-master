/**
 * RateLimitConfigService — in-memory management of notification rate
 * limit configuration.
 *
 * Seeded from the DEFAULT_RATE_LIMITS constant in the notification-service
 * rate-limiter module.
 */

import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CollapseRule {
  eventType: string;
  maxPerHour: number;
  windowMinutes: number;
}

export interface RateLimitConfig {
  pushPerHour: number;
  emailPerDay: number;
  smsPerDay: number;
  collapseRules: CollapseRule[];
  dedupWindowSeconds: number;
}

export interface UpdateRateLimitInput {
  pushPerHour?: number;
  emailPerDay?: number;
  smsPerDay?: number;
  collapseRules?: CollapseRule[];
  dedupWindowSeconds?: number;
}

// ---------------------------------------------------------------------------
// Defaults — mirrors notification-service/src/core/rate-limiter.ts
// ---------------------------------------------------------------------------

function buildDefaults(): RateLimitConfig {
  return {
    pushPerHour: 20,
    emailPerDay: 10,
    smsPerDay: 5,
    collapseRules: [
      { eventType: 'scoring.position_change', maxPerHour: 3, windowMinutes: 15 },
      { eventType: 'scoring.overtaken', maxPerHour: 2, windowMinutes: 30 },
      { eventType: 'draft.pick_made', maxPerHour: 30, windowMinutes: 5 },
    ],
    dedupWindowSeconds: 300,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RateLimitConfigService {
  private config: RateLimitConfig = buildDefaults();

  async getConfig(): Promise<RateLimitConfig> {
    return { ...this.config, collapseRules: [...this.config.collapseRules] };
  }

  async updateConfig(
    updates: UpdateRateLimitInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<RateLimitConfig> {
    const beforeState = {
      ...this.config,
      collapseRules: [...this.config.collapseRules],
    };

    if (updates.pushPerHour !== undefined) this.config.pushPerHour = updates.pushPerHour;
    if (updates.emailPerDay !== undefined) this.config.emailPerDay = updates.emailPerDay;
    if (updates.smsPerDay !== undefined) this.config.smsPerDay = updates.smsPerDay;
    if (updates.collapseRules !== undefined) this.config.collapseRules = updates.collapseRules;
    if (updates.dedupWindowSeconds !== undefined) this.config.dedupWindowSeconds = updates.dedupWindowSeconds;

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.rate_limits.update',
      resourceType: 'RATE_LIMIT_CONFIG',
      resourceId: 'global',
      description: 'Updated global rate limit configuration',
      beforeState: beforeState as unknown as Record<string, unknown>,
      afterState: this.config as unknown as Record<string, unknown>,
    });

    return this.getConfig();
  }

  async resetConfig(
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<RateLimitConfig> {
    const beforeState = {
      ...this.config,
      collapseRules: [...this.config.collapseRules],
    };

    this.config = buildDefaults();

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.rate_limits.reset',
      resourceType: 'RATE_LIMIT_CONFIG',
      resourceId: 'global',
      description: 'Reset global rate limit configuration to defaults',
      beforeState: beforeState as unknown as Record<string, unknown>,
      afterState: this.config as unknown as Record<string, unknown>,
    });

    return this.getConfig();
  }
}
