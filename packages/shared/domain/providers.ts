/**
 * Reserved provider identity for admin-authored SportEvent rows (plans/124
 * §3.5). No adapter is ever registered for this id (ProviderRegistry.register
 * throws if asked to), so a manual/admin-managed tournament cannot be
 * scheduled or manually targeted by any sync route.
 */
export const MANUAL_ADMIN_PROVIDER_ID = 'manual-admin';
