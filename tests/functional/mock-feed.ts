import type { MockFeedEventState } from '../support/mock-contest-feed-provider';
import { readFunctionalServerState } from './state';

/**
 * Pins one mock feed event to a scripted state (#2039): the functional server's fake provider
 * answers that event's detail and scores in it until the next pin. The daemon is shared by
 * concurrent runs, so each test pins only the external ids its own fixtures use.
 */
export async function pinMockFeedEventState(externalEventId: string, state: MockFeedEventState): Promise<void> {
  const { mockFeedUrl } = readFunctionalServerState();
  if (!mockFeedUrl) {
    throw new Error(
      'The functional server state has no mockFeedUrl: a daemon started by older code is still '
        + 'running. Stop it (coverage/service-functional-api/daemon/server-state.json has its pid) and re-run.',
    );
  }
  const response = await fetch(`${mockFeedUrl}/test/event-states/${encodeURIComponent(externalEventId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  if (response.status !== 204) {
    throw new Error(`Pinning ${externalEventId} to ${state} returned ${response.status}`);
  }
}
