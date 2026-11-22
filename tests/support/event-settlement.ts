/**
 * The settle-job ports an `EventLifecycleService` requires, for a test that runs no settle job.
 * Settlement fails loudly if a test reaches it unawares. A test of a settle job passes the ports it watches.
 */

import type { EventSettlementDeps } from '../../packages/core-api/src/modules/events/event-lifecycle-service';

export const NO_SETTLE_JOBS: EventSettlementDeps = {
  contestSettlement: {
    settleFinishedSportEvent: async () => {
      throw new Error('This test runs no settle job, but settleFinishedSportEvent was called: pass the contest settlement it watches');
    },
    settleFinishedGame: async () => {
      throw new Error('This test runs no settle job, but settleFinishedGame was called: pass the contest settlement it watches');
    },
  },
};
