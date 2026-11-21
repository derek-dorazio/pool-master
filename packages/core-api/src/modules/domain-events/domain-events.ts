/**
 * DomainEvents (#1946): collects the follow-up jobs of a change from `DOMAIN_EVENT_HANDLERS`. A
 * writer describes what changed, collects before its write, hands the jobs to the write so they
 * land in its transaction, and calls `queued()` once the write has committed. A write that fails
 * or loses a guarded race leaves `queued` uncalled and its jobs unwritten.
 */

import type { BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue, JobsForWrite } from '../background-jobs/background-job-queue';
import type { DomainEvent, DomainEventOf, DomainEventType } from './domain-event';
import type { DomainEventHandlerContext, DomainEventHandlerMap } from './domain-event-handler';
import { DOMAIN_EVENT_HANDLERS } from './domain-event-handlers';

/**
 * The jobs of a guarded batch write, which learns only inside its transaction which rows moved:
 * `jobsFor` answers the jobs of the moved subjects' events, and `queued` wakes the runner once the
 * write has committed.
 */
export interface JobsForBatchWrite {
  /** Whether any subject's event has jobs at all, so a batch none of whose events has any needs no transaction. */
  readonly hasJobs: boolean;
  jobsFor(movedSubjectIds: readonly string[]): BackgroundJobRequest[];
  queued(): void;
}

export interface DomainEventsDeps extends DomainEventHandlerContext {
  queue: Pick<BackgroundJobQueue, 'request' | 'queued'>;
}

/** What a route module whose writes collect follow-ups takes (#1949): the app's one map, built in index.ts. */
export interface DomainEventsModuleOptions {
  domainEvents: Pick<DomainEvents, 'collect' | 'collectEach'>;
}

export class DomainEvents {
  constructor(private readonly deps: DomainEventsDeps) {}

  /** The jobs that follow `event`, from each of its handlers whose `when` takes it, in map order. */
  async collect(event: DomainEvent): Promise<JobsForWrite> {
    return this.forWrite(await this.jobsOf(event));
  }

  /**
   * The jobs of several events for one guarded batch write, by the subject each event is about
   * (`subjectOf`, a contest's id for a contest's change): collected before the write, and handed
   * to it for only the subjects it moved.
   */
  async collectEach<E extends DomainEvent>(events: readonly E[], subjectOf: (event: E) => string): Promise<JobsForBatchWrite> {
    const bySubject = new Map<string, BackgroundJobRequest[]>();
    for (const event of events) {
      const jobs = await this.jobsOf(event);
      const subject = subjectOf(event);
      bySubject.set(subject, [...(bySubject.get(subject) ?? []), ...jobs]);
    }
    let anyJobs = false;
    return {
      hasJobs: [...bySubject.values()].some((jobs) => jobs.length > 0),
      jobsFor: (movedSubjectIds) => {
        const jobs = movedSubjectIds.flatMap((id) => bySubject.get(id) ?? []);
        anyJobs ||= jobs.length > 0;
        return jobs;
      },
      queued: () => { if (anyJobs) this.deps.queue.queued(); },
    };
  }

  private forWrite(jobs: readonly BackgroundJobRequest[]): JobsForWrite {
    return { jobs, queued: () => { if (jobs.length > 0) this.deps.queue.queued(); } };
  }

  private async jobsOf(event: DomainEvent): Promise<BackgroundJobRequest[]> {
    return this.jobsOfType(event.type, event);
  }

  private async jobsOfType<T extends DomainEventType>(type: T, event: DomainEventOf<T>): Promise<BackgroundJobRequest[]> {
    const handlers: DomainEventHandlerMap[T] = (DOMAIN_EVENT_HANDLERS satisfies DomainEventHandlerMap as DomainEventHandlerMap)[type];
    const jobs: BackgroundJobRequest[] = [];
    for (const handler of handlers) {
      if (handler.when && !handler.when(event)) continue;
      jobs.push(...await handler.jobs(event, this.deps));
    }
    return jobs;
  }
}
