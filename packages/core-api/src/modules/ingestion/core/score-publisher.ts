/**
 * Score Publisher — the entry point for live-score updates from provider
 * adapters. Per plans/117 §10.3:
 *
 *   1. Validate the typed `LiveScoreResult` with Zod (malformed adapter
 *      payloads fail here, not inside the persistence path).
 *   2. Resolve provider-side `participantExternalId` to internal
 *      `SportEventParticipant.id` UUIDs.
 *   3. Persist the per-category detail rows (Phase 4 ships the GOLF
 *      variant, delegated to `GolfScoreService` — plans/124 §3.1; other
 *      categories throw `LiveScoreUnsupportedError`).
 *
 * It used to emit a `live_score.persisted` event as a fourth step. Nothing
 * ever subscribed, so #261 removed the event bus with it: the persisted rows
 * are the outcome, and callers read those.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  LiveScoreResultSchema,
  type LiveScoreResult,
} from '@poolmaster/shared/dto';
import type { SyncWriteDiagnostics } from './sync-write-diagnostics';
import { emptySyncWriteDiagnostics } from './sync-write-diagnostics';
import { createGolfScoreService } from '../../events/wiring';

export class LiveScoreValidationError extends Error {
  constructor(reason: string, public readonly issues: unknown) {
    super(`LiveScoreResult failed Zod validation: ${reason}`);
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
  logger?: FastifyBaseLogger;
}

export interface LiveScorePersistenceResult {
  updatesReturned: number;
  updatesPersisted: number;
  updatesSkipped: number;
  writeDiagnostics: SyncWriteDiagnostics;
}

/**
 * Validate and persist. Returns event-side persistence diagnostics for
 * normalized round and standing rows; skipped provider rows are counted in
 * stats but are not written as fake diagnostic entities.
 */
export async function publishLiveScoreUpdate(
  result: LiveScoreResult,
  deps: LiveScorePublisherDeps,
): Promise<LiveScorePersistenceResult> {
  // 1. Validate before anything is persisted.
  const parsed = LiveScoreResultSchema.safeParse(result);
  if (!parsed.success) {
    deps.logger?.error(
      {
        action: 'liveScore.publish.validationFailed',
        data: { providerId: deps.providerId, issues: parsed.error.issues },
      },
      'Rejected LiveScoreResult that failed schema validation',
    );
    throw new LiveScoreValidationError('schema mismatch', parsed.error.issues);
  }
  const validated = parsed.data;
  const updatesReturned = countLiveScoreUpdates(validated);

  // 2/3. Resolve external → internal SportEvent so persistence is scoped
  // to one event, then dispatch to the per-category persistence path.
  const sportEvent = await deps.prisma.sportEvent.findUnique({
    where: { providerId_externalId: { providerId: deps.providerId, externalId: validated.externalEventId } },
    select: { id: true, syncScope: true },
  });
  if (!sportEvent) {
    deps.logger?.warn(
      {
        action: 'liveScore.publish.unknownSportEvent',
        data: { providerId: deps.providerId, externalEventId: validated.externalEventId, category: validated.category },
      },
      'Skipping live-score persistence — no internal SportEvent matches (providerId, externalEventId)',
    );
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
      persistenceResult = await createGolfScoreService(deps.prisma, deps.logger).persistRoundUpdatesForSportEvent(
        sportEvent.id,
        validated.rounds,
        deps.providerId,
        sportEvent.syncScope,
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

