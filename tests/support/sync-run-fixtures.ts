import type { ProviderSyncRun } from '@poolmaster/shared/domain';

/**
 * What every sync run says about itself (#1819), for a test whose run's kind, trigger and scope
 * are not what it checks: a scheduled scores sync with no PoolMaster ids and no job.
 */
export const SCHEDULED_SCORES_RUN: Pick<ProviderSyncRun, 'kind' | 'trigger' | 'sportLeagueId' | 'sportEventId' | 'backgroundJobId'> = {
  kind: 'SCORES',
  trigger: 'SCHEDULE',
  sportLeagueId: null,
  sportEventId: null,
  backgroundJobId: null,
};
