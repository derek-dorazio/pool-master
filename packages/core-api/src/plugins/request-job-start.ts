import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { JobTrigger, JobTriggerOrder, type PersonJobTrigger } from '@poolmaster/shared/domain';
import { runWithJobStartSource } from '../core/job-start';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The role the route requires, as its permission gate set it (#1861): what a job the request
     * queues records, with the signed-in person.
     */
    jobTrigger?: PersonJobTrigger;
  }
}

/**
 * A permission gate admitted the request to a route that requires `trigger`'s role: a root admin
 * route ADMIN, a league's commissioner tools COMMISSIONER. A route behind both requires the
 * stronger, the one earlier in the trigger's order, whichever runs first. The role is the
 * route's, not the person's: a root admin using commissioner tools is a COMMISSIONER.
 */
export function actsAs(request: FastifyRequest, trigger: PersonJobTrigger): void {
  const current = request.jobTrigger;
  if (current === undefined || JobTriggerOrder.orderIndex[trigger] < JobTriggerOrder.orderIndex[current]) {
    request.jobTrigger = trigger;
  }
}

/**
 * Opens each request's job start (#1861): a job the request queues records the role its route
 * requires (`actsAs`) and the signed-in person, read when the job is queued, after the gates and
 * the auth guard have run. A member's own request queues no job of its own
 * (`rules/architecture-rules.md` §4 *Service Topology*); the upkeep it asks for, such as rebuilding a contest's stale board
 * once per contest, records SYSTEM. A request with no one signed in says nothing, so a job it
 * queued would throw, unless the code queueing it says what started it, as the provider webhook
 * receiver does (WEBHOOK).
 *
 * Callback style for the same reason as the read memo: every later hook and the handler run
 * inside the scope.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- registered like the other plugins.
async function requestJobStartPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', (request, _reply, done) => {
    runWithJobStartSource(
      () => {
        if (!request.authUser) return undefined;
        return request.jobTrigger === undefined
          ? { trigger: JobTrigger.SYSTEM }
          : { trigger: request.jobTrigger, startedByUserId: request.authUser.userId };
      },
      done,
    );
  });
}

export const requestJobStart = fp(requestJobStartPlugin, {
  name: 'request-job-start',
  fastify: '5.x',
});
