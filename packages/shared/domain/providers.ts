import { ProviderCode, ProviderHealthStatus } from './enums';

/**
 * Each provider adapter's own id, by its Provider code (#1997): the key the provider registry and
 * the sync's provider refs use until the registry is keyed by Provider (#2073). Every stored row
 * holds a Provider foreign key instead (#2040, #2004).
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
 * The Provider code of the adapter with this id, or undefined for an id no Provider carries,
 * which syncs nothing.
 */
export function providerCodeOfSourceId(providerId: string): ProviderCode | undefined {
  return (Object.keys(PROVIDER_SOURCE_IDS) as ProviderCode[]).find((code) => PROVIDER_SOURCE_IDS[code] === providerId);
}

/**
 * The Provider code of the adapter whose feed carries `providerId` (#2040): every participant
 * mapping, sync run and sync job is keyed to a Provider row, so an adapter with none can write
 * none of them. Throws for one.
 */
export function requireProviderCodeOfSourceId(providerId: string): ProviderCode {
  const code = providerCodeOfSourceId(providerId);
  if (code === undefined) throw new Error(`Provider ${providerId} has no Provider row.`);
  return code;
}

/**
 * The provider's id for an event (#2004): the sync writes one when it creates the event from its
 * provider's schedule. A test event, made by hand on a test slot, has none.
 */
export interface SportEventProviderMapping {
  providerCode: ProviderCode;
  /** The provider's name, read with its code so no reader looks it up. */
  providerName: string;
  /** The provider's own id for the event, as it sends it. */
  externalId: string;
}

/** An event's id at a provider, as the provider adapters key it: the adapter's id and the event's. */
export interface ProviderEventRef {
  providerId: string;
  externalId: string;
}

/**
 * The event's id at its sport league's sync provider (#2004, ADR 0011), as the adapters key it:
 * undefined for a test event, for an event of a league no provider syncs, and for one whose
 * league's provider has no id for it.
 */
export function eventFeedRef(event: {
  providerMappings: readonly SportEventProviderMapping[];
  syncProviderId?: string;
}): ProviderEventRef | undefined {
  if (event.syncProviderId === undefined) return undefined;
  const mapping = event.providerMappings.find((each) => providerSourceIdOf(each.providerCode) === event.syncProviderId);
  return mapping === undefined ? undefined : { providerId: event.syncProviderId, externalId: mapping.externalId };
}

/**
 * Whether an event's details come from its provider's sync (ADR 0011): its sport league is synced
 * by a provider (`syncProviderId`, its selected mapping's provider), and that provider has an id
 * for the event. The provider wins over an admin's edit to such an event's name, venue and dates
 * (`rules/architecture-rules.md` §4 *A live provider sync is the source of its league's events*),
 * so the admin pages show them read-only.
 */
export function isProviderSyncedEvent(event: {
  providerMappings: readonly SportEventProviderMapping[];
  syncProviderId?: string;
}): boolean {
  return eventFeedRef(event) !== undefined;
}

/**
 * The name of the provider an event is synced from (#1999): its sport league's sync provider, when
 * that provider has an id for the event; null for a test event.
 */
export function eventProviderNameOf(event: {
  providerMappings: readonly SportEventProviderMapping[];
  syncProviderId?: string;
}): string | null {
  if (event.syncProviderId === undefined) return null;
  return event.providerMappings.find((each) => providerSourceIdOf(each.providerCode) === event.syncProviderId)?.providerName ?? null;
}

/** How many of a Provider's sync runs finished in a window, and how many of those failed. */
export interface ProviderSyncRunCounts {
  /** The Provider row. */
  providerId: string;
  finished: number;
  failed: number;
}

/**
 * A Provider's health from its own sync runs (#1999), never from a live call: no finished run in
 * the window is unknown (null); none failed is HEALTHY, all failed is DOWN, and some failed is
 * DEGRADED. The error rate is the failed share.
 */
export function providerHealthOfRuns(counts: Pick<ProviderSyncRunCounts, 'finished' | 'failed'> | undefined): {
  status: ProviderHealthStatus | null;
  errorRate: number | null;
} {
  if (counts === undefined || counts.finished === 0) return { status: null, errorRate: null };
  const errorRate = counts.failed / counts.finished;
  const status = counts.failed === 0
    ? ProviderHealthStatus.HEALTHY
    : counts.failed === counts.finished ? ProviderHealthStatus.DOWN : ProviderHealthStatus.DEGRADED;
  return { status, errorRate };
}
