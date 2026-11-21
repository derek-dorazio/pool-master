/**
 * The app's domain event handler map (#1946) over test ports: a real `DomainEvents`, collecting
 * from the real `DOMAIN_EVENT_HANDLERS`, with a queue over the in-memory job table unless a test
 * passes its own, no template contests a release joins, and nobody told of a postponed or moved
 * event. A test about one of those follow-ups passes the port it watches.
 */

import { BackgroundJobQueue } from '../../packages/core-api/src/modules/background-jobs';
import { DomainEvents, type DomainEventHandlerContext, type DomainEventsDeps } from '../../packages/core-api/src/modules/domain-events';
import type { EventLifecycleService } from '../../packages/core-api/src/modules/events/event-lifecycle-service';
import { inMemoryBackgroundJobs, testCurrentJobStart } from './in-memory-background-jobs';

/** Template contests no release joins. */
export const NO_TEMPLATE_CONTESTS: DomainEventHandlerContext['releasedEditionContests'] = { releasedEditionJobs: async () => [] };

/** Nobody told of a postponed or moved event. */
export const NOBODY_TOLD: DomainEventHandlerContext['sportEventChanged'] = { sportEventChangedJobs: async () => [] };

export function testDomainEvents(deps: Partial<DomainEventsDeps> = {}): DomainEvents {
  return new DomainEvents({
    queue: deps.queue ?? new BackgroundJobQueue({ jobs: inMemoryBackgroundJobs(), currentStart: testCurrentJobStart }),
    releasedEditionContests: deps.releasedEditionContests ?? NO_TEMPLATE_CONTESTS,
    sportEventChanged: deps.sportEventChanged ?? NOBODY_TOLD,
  });
}

/**
 * No contest goes live: the event lifecycle's activation, for a test of a writer that is not about
 * contests going live. A test that is passes the lifecycle it watches.
 */
export const NO_CONTEST_ACTIVATION: Pick<EventLifecycleService, 'activateContestsPastCutoff'> = { activateContestsPastCutoff: async () => undefined };
