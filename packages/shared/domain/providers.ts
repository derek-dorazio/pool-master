import { ProviderCode, SportEventSyncScope } from './enums';

/**
 * Reserved provider identity for admin-authored SportEvent rows (plans/124
 * §3.5). No adapter is ever registered for this id (ProviderRegistry.register
 * throws if asked to), so a manual/admin-managed tournament cannot be
 * scheduled or manually targeted by any sync route.
 */
export const MANUAL_ADMIN_PROVIDER_ID = 'manual-admin';


/**
 * The id each provider's events, participants and runs still carry as `providerId` (#1997), by
 * its Provider code: the adapter's own id. It goes when those columns become Provider foreign
 * keys (league model slices 1e and 7).
 */
/** A provider id as its events carry it (`balldontlie`): an id, not a display word. */
type ProviderSourceId = string;

const PROVIDER_SOURCE_IDS: Readonly<Record<ProviderCode, ProviderSourceId>> = {
  [ProviderCode.BALLDONTLIE]: 'balldontlie',
};

/** The `providerId` a provider's events and participants carry, from its Provider code. */
export function providerSourceIdOf(code: ProviderCode): string {
  return PROVIDER_SOURCE_IDS[code];
}

/**
 * The Provider code whose events carry this `providerId`, or undefined for one with no Provider
 * row (the QA mock feed, until #2039), which syncs no league.
 */
export function providerCodeOfSourceId(providerId: string): ProviderCode | undefined {
  return (Object.keys(PROVIDER_SOURCE_IDS) as ProviderCode[]).find((code) => PROVIDER_SOURCE_IDS[code] === providerId);
}

/**
 * Whether an event's details come from its provider's sync (ADR 0011): its sport league is synced
 * by a provider (`syncProviderId`, its selected mapping's provider), and the event is linked to that
 * provider for scores. The provider wins over an
 * admin's edit to such an event's name, venue and dates (`rules/architecture-rules.md` §4 *A live
 * provider sync is the source of its league's events*), so the admin pages show them read-only.
 */
export function isProviderSyncedEvent(event: {
  providerId: string;
  syncScope: SportEventSyncScope;
  syncProviderId?: string;
}): boolean {
  return event.syncProviderId !== undefined
    && event.syncProviderId === event.providerId
    && event.syncScope === SportEventSyncScope.SCORES_ONLY;
}
