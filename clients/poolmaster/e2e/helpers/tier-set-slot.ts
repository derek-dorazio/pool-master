import type { APIRequestContext } from '@playwright/test';
import { expectOk, type AuthHeaders } from './admin-api';

/**
 * The URL prefix of an event's tier-set slot (#2044), `/api/v1/events/<event>/slots/<slot>`, read
 * from the event: the slot tier and price routes hang off it. A browser step reads it with the
 * page's own request context; an API step passes its admin headers.
 */
export async function tierSetSlotUrl(request: APIRequestContext, eventId: string, headers?: AuthHeaders): Promise<string> {
  const path = `/api/v1/events/${eventId}`;
  const response = await expectOk(request.get(path, headers ? { headers } : {}), `GET ${path}`);
  const { event } = (await response.json()) as { event: { tierSets: Array<{ seasonSlotId: string; isTierSetSlot: boolean }> } };
  const tierSet = event.tierSets.find((set) => set.isTierSetSlot);
  if (!tierSet) throw new Error(`Event ${eventId} lists no tier-set slot.`);
  return `${path}/slots/${tierSet.seasonSlotId}`;
}
