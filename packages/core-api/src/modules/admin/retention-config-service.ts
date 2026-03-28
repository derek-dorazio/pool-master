/**
 * RetentionConfigService — platform-wide default retention policies.
 *
 * Provides hardcoded defaults that apply across the platform, with the ability
 * for admins to override globally or per-tenant. Per-league retention (managed
 * by commissioners) falls back to these defaults when not explicitly set.
 */

export interface RetentionDefaults {
  contestResultRetentionSeasons: number;
  rosterHistoryRetentionSeasons: number;
  activityLogRetentionDays: number;
  payoutRecordRetentionSeasons: number;
  chatMessageRetentionDays: number;
  auditLogRetentionDays: number;
}

const HARDCODED_DEFAULTS: RetentionDefaults = {
  contestResultRetentionSeasons: -1,
  rosterHistoryRetentionSeasons: -1,
  activityLogRetentionDays: 365,
  payoutRecordRetentionSeasons: -1,
  chatMessageRetentionDays: 90,
  auditLogRetentionDays: -1,
};

export class RetentionConfigService {
  private defaults: RetentionDefaults = { ...HARDCODED_DEFAULTS };
  private readonly tenantOverrides = new Map<string, RetentionDefaults>();

  // ---------------------------------------------------------------------------
  // Platform defaults
  // ---------------------------------------------------------------------------

  getDefaults(): RetentionDefaults {
    return { ...this.defaults };
  }

  updateDefaults(updates: Partial<RetentionDefaults>): RetentionDefaults {
    this.defaults = { ...this.defaults, ...updates };
    return { ...this.defaults };
  }

  resetDefaults(): RetentionDefaults {
    this.defaults = { ...HARDCODED_DEFAULTS };
    return { ...this.defaults };
  }

  // ---------------------------------------------------------------------------
  // Per-tenant overrides
  // ---------------------------------------------------------------------------

  getTenantOverride(tenantId: string): RetentionDefaults | null {
    const override = this.tenantOverrides.get(tenantId);
    return override ? { ...override } : null;
  }

  setTenantOverride(
    tenantId: string,
    overrides: Partial<RetentionDefaults>,
  ): RetentionDefaults {
    const base = this.tenantOverrides.get(tenantId) ?? { ...this.defaults };
    const merged: RetentionDefaults = { ...base, ...overrides };
    this.tenantOverrides.set(tenantId, merged);
    return { ...merged };
  }

  clearTenantOverride(tenantId: string): void {
    this.tenantOverrides.delete(tenantId);
  }
}
