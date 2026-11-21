/**
 * The app's domain event handler map (#1946) over test ports, recording what each write told it:
 * a real `DomainEvents` collecting from the real `DOMAIN_EVENT_HANDLERS` (`testDomainEvents`), so a
 * write is handed the jobs the app would write with it. `collected` is every event a write
 * described; `committed` only those whose write called `queued()`, that is, committed.
 */

import type { JobsForWrite } from '../../packages/core-api/src/modules/background-jobs';
import { DomainEventType, type DomainEvent, type DomainEvents, type DomainEventsDeps } from '../../packages/core-api/src/modules/domain-events';
import { testDomainEvents } from './domain-events';

type ResultsEvent = Extract<DomainEvent, { type: typeof DomainEventType.SPORT_EVENT_RESULTS_CHANGED | typeof DomainEventType.GAME_DECIDED }>;

const isResultsEvent = (event: DomainEvent): event is ResultsEvent =>
  event.type === DomainEventType.SPORT_EVENT_RESULTS_CHANGED || event.type === DomainEventType.GAME_DECIDED;

export class RecordingDomainEvents implements Pick<DomainEvents, 'collect'> {
  readonly collected: DomainEvent[] = [];
  readonly committed: DomainEvent[] = [];
  private readonly events: DomainEvents;

  constructor(deps: Partial<DomainEventsDeps> = {}) {
    this.events = testDomainEvents(deps);
  }

  async collect(event: DomainEvent): Promise<JobsForWrite> {
    this.collected.push(event);
    const written = await this.events.collect(event);
    return { jobs: written.jobs, queued: () => { this.committed.push(event); written.queued(); } };
  }

  /** The events whose results a write changed, one entry per committed write that told so. */
  get changedSportEventIds(): string[] {
    return this.resultsOf(this.committed);
  }

  /** The events a write described a results change of, committed or not. */
  get handedOutSportEventIds(): string[] {
    return this.resultsOf(this.collected);
  }

  private resultsOf(events: readonly DomainEvent[]): string[] {
    return events.filter(isResultsEvent).map((event) => event.sportEventId);
  }
}
