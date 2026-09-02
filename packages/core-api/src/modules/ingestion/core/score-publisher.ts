/**
 * Score Publisher — bus-boundary entry point for live-score updates from
 * provider adapters. Per plans/117 §10.3:
 *
 *   1. Validate the typed `LiveScoreResult` with Zod (malformed adapter
 *      payloads fail at the bus boundary, not inside the scoring consumer).
 *   2. Resolve provider-side `participantExternalId` to internal
 *      `SportEventParticipant.id` UUIDs.
 *   3. Persist the per-category detail rows (Phase 4 ships the GOLF
 *      variant, delegated to `GolfScoreService` — plans/124 §3.1; other
 *      categories throw `LiveScoreUnsupportedError`).
 *   4. Emit a typed `live_score.persisted` event for downstream consumers.
 *
 * This replaces the legacy `publishStatEvents` path which forwarded
 * untyped `ProviderStatEvent[]` payloads onto the `stat.received` event.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { eventBus } from '@poolmaster/shared/events/event-bus';
import type { LiveScorePersistedEvent } from '@poolmaster/shared/events';
import {
  LiveScoreResultSchema,
  type LiveScoreResult,
} from '@poolmaster/shared/dto';
import { randomUUID } from 'node:crypto';
import type { SyncWriteDiagnostics } from './sync-write-diagnostics';
import { emptySyncWriteDiagnostics } from './sync-write-diagnostics';
import { GolfScoreService } from '../../golf/golf-score-service';

export class LiveScoreValidationError extends Error {
  constructor(reason: string, public readonly issues: unknown) {
    super(`LiveScoreResult failed Zod validation at bus boundary: ${reason}`);
    this.name = 'LiveScoreValidationError';
  }
}

export class LiveScorePersistenceUnsupportedError extends Error {
  constructor(category: string) {
    super(
      `LiveScoreResult category ${category} persistence not yet implemented. ` +
        `Per plans/117 §3.1, Phase 4 ships only the GOLF persistence path; ` +
        `the rest land in future rop.78.<N> slices.`,
    );
    this.name = 'LiveScorePersistenceUnsupportedError';
  }
}

export interface LiveScorePublisherDeps {
  prisma: PrismaClient;
  providerId: string;
  /** Optional override for tests; defaults to the shared eventBus. */
  bus?: typeof eventBus;
  logger?: FastifyBaseLogger;
}

export interface LiveScorePersistenceResult {
  updatesReturned: number;
  updatesPersisted: number;
  updatesSkipped: number;
  writeDiagnostics: SyncWriteDiagnostics;
}

/**
 * Validate, persist, and emit. Returns event-side persistence diagnostics for
 * normalized round and standing rows; skipped provider rows are counted in
 * stats but are not written as fake diagnostic entities.
 */
export async function publishLiveScoreUpdate(
  result: LiveScoreResult,
  deps: LiveScorePublisherDeps,
): Promise<LiveScorePersistenceResult> {
  // 1. Validate at the bus boundary.
  const parsed = LiveScoreResultSchema.safeParse(result);
  if (!parsed.success) {
    deps.logger?.error(
      {
        action: 'liveScore.publish.validationFailed',
        data: { providerId: deps.providerId, issues: parsed.error.issues },
      },
      'Rejected LiveScoreResult at bus boundary',
    );
    throw new LiveScoreValidationError('schema mismatch', parsed.error.issues);
  }
  const validated = parsed.data;
  const updatesReturned = countLiveScoreUpdates(validated);

  // 2/3. Resolve external → internal SportEvent so persistence is scoped
  // to one event, then dispatch to the per-category persistence path.
  const sportEvent = await deps.prisma.sportEvent.findUnique({
    where: { providerId_externalId: { providerId: deps.providerId, externalId: validated.externalEventId } },
    select: { id: true },
  });
  if (!sportEvent) {
    deps.logger?.warn(
      {
        action: 'liveScore.publish.unknownSportEvent',
        data: { providerId: deps.providerId, externalEventId: validated.externalEventId, category: validated.category },
      },
      'Skipping live-score persistence — no internal SportEvent matches (providerId, externalEventId)',
    );
    // Skip the bus emission too. live_score.persisted requires sportEventId
    // because consumers read the persisted rows by (sportEventId, category);
    // a phantom zero-update event with no usable sportEventId is just noise.
    // The WARN above is the diagnostic record.
    return {
      updatesReturned,
      updatesPersisted: 0,
      updatesSkipped: updatesReturned,
      writeDiagnostics: emptySyncWriteDiagnostics(),
    };
  }

  let persistenceResult: LiveScorePersistenceResult;
  switch (validated.category) {
    case 'GOLF':
      persistenceResult = await new GolfScoreService(deps.prisma, deps.logger).persistRoundUpdatesForSportEvent(
        sportEvent.id,
        validated.rounds,
        deps.providerId,
      );
      break;
    case 'BASKETBALL':
    case 'F1':
    case 'NFL':
    case 'NASCAR':
    case 'TENNIS':
    case 'SOCCER':
      throw new LiveScorePersistenceUnsupportedError(validated.category);
  }

  // 4. Emit typed bus event. sportEventId carries the resolved internal id
  // so consumers can read the persisted detail rows by (sportEventId, category)
  // without re-resolving from externalEventId + providerId.
  // Subscriber failures are treated as live-score ingestion failures. The
  // polling run is idempotent, so the next poll can retry after the failed
  // provider_sync_runs row captures the error context.
  const persistedEvent: LiveScorePersistedEvent = {
    id: randomUUID(),
    type: 'live_score.persisted',
    sourceService: 'ingestion-worker',
    timestamp: new Date().toISOString(),
    category: validated.category,
    providerId: deps.providerId,
    sportEventId: sportEvent.id,
    updatesPersisted: persistenceResult.updatesPersisted,
    ingestedAt: new Date().toISOString(),
  };
  await (deps.bus ?? eventBus).publish('live_score.persisted', persistedEvent);

  return persistenceResult;
}

function countLiveScoreUpdates(result: LiveScoreResult): number {
  switch (result.category) {
    case 'GOLF':
      return result.rounds.length;
    case 'BASKETBALL':
      return result.games.length;
    case 'F1':
      return result.results.length;
    case 'NFL':
      return result.games.length;
    case 'NASCAR':
      return result.results.length;
    case 'TENNIS':
      return result.matches.length;
    case 'SOCCER':
      return result.matches.length;
  }
}

