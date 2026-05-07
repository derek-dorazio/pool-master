export type {
  SportDataProvider,
  DateRange,
  SportEvent,
  SportEventDetail,
  ProviderParticipant,
  ProviderRanking,
  ProviderEventResult,
  ProviderParticipantResult,
  ProviderHealthStatus,
} from './provider-interface';
export { LiveScoreUnsupportedError } from './provider-interface';

export { ProviderRegistry } from './provider-registry';
export { IngestionScheduler } from './ingestion-scheduler';
export type {
  EventSyncRequest,
  IngestionCallbacks,
  IngestionFeedType,
  IngestionJobRecord,
  JobType,
  SportSyncRequest,
} from './ingestion-scheduler';
export {
  publishLiveScoreUpdate,
  LiveScoreValidationError,
  LiveScorePersistenceUnsupportedError,
} from './score-publisher';
export type { LiveScorePublisherDeps } from './score-publisher';
