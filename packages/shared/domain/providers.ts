import { SportEventSyncScope } from './enums';

/**
 * Reserved provider identity for admin-authored SportEvent rows (plans/124
 * §3.5). No adapter is ever registered for this id (ProviderRegistry.register
 * throws if asked to), so a manual/admin-managed tournament cannot be
 * scheduled or manually targeted by any sync route.
 */
export const MANUAL_ADMIN_PROVIDER_ID = 'manual-admin';


/**
 * Whether an event's details come from its provider's sync (ADR 0011): its sport league is synced
 * by a provider, and the event is linked to that provider for scores. The provider wins over an
 * admin's edit to such an event's name, venue and dates (`rules/architecture-rules.md` §4 *A live
 * provider sync is the source of its league's events*), so the admin pages show them read-only.
 */
export function isProviderSyncedEvent(event: {
  providerId: string;
  syncScope: SportEventSyncScope;
  eventSyncProviderId?: string;
}): boolean {
  return event.eventSyncProviderId !== undefined
    && event.eventSyncProviderId === event.providerId
    && event.syncScope === SportEventSyncScope.SCORES_ONLY;
}
