/**
 * Score Publisher — the entry point for live-score updates from provider
 * adapters. Per plans/117 §10.3:
 *
 *   1. Validate the typed `LiveScoreResult` with Zod (malformed adapter
 *      payloads fail here, not inside the persistence path).
 *   2. Resolve provider-side `participantExternalId` to internal
 *      `SportEventParticipant.id` UUIDs.
 *   3. Skip the update unless the event is IN_PROGRESS, and unless the
 *      event's scoring family accepts the batch's live-score category.
 *   4. Persist the batch through the event's scoring family, which writes
 *      its own result rows (stroke play: `GolfScoreService`).
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
import { SportEventStatus } from '@poolmaster/shared/domain';
import type { SyncWriteDiagnostics } from './sync-write-diagnostics';
import { emptySyncWriteDiagnostics } from './sync-write-diagnostics';
import type { LiveScoreTargetEvent, LiveScoreWriteDeps, LiveScoreWriter, ScoringFamilyEvent, ScoringFamilyModule } from '../../scoring-families';
import { countLiveScoreUpdates } from './live-score-count';
import type { EventFieldCache } from '../../events/event-field-cache';
import type { LeaderboardRebuilds } from '../../contests/leaderboard-snapshots';

export class LiveScoreValidationError extends Error {
  constructor(reason: string, public readonly issues: unknown) {
    super(`LiveScoreResult failed Zod validation: ${reason}`);
    this.name = 'LiveScoreValidationError';
  }
}

export interface LiveScorePublisherDeps {
  prisma: PrismaClient;
  providerId: string;
  logger?: FastifyBaseLogger;
  /** Which scoring family scores an event, by its sport league's definition: the composition root passes the registry's. */
  scoringFamilyForEvent: (event: ScoringFamilyEvent) => ScoringFamilyModule;
  /** The event fields this container read lately: an event's is forgotten once its scores are written (#1163). */
  fieldCache?: Pick<EventFieldCache, 'forget'>;
  /**
   * The event's leaderboard rebuild, handed to the scoring family's writer so its last write
   * carries the job (#1435, #1466): scores that fail to write queue no rebuild.
   */
  leaderboards?: Pick<LeaderboardRebuilds, 'forEvent'>;
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
    select: { id: true, sport: true, rounds: true, status: true, eventSeries: { select: { sportLeague: { select: { scoringFamily: true, roundSeriesLengths: true } } } } },
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

  // A live score is accepted only while its event is in progress: before, there is nothing to
  // score; after, the admin alone corrects scores (#116) and settlement has already run.
  if (sportEvent.status !== SportEventStatus.IN_PROGRESS) {
    deps.logger?.warn(
      {
        action: 'liveScore.publish.eventNotInProgress',
        data: { providerId: deps.providerId, externalEventId: validated.externalEventId, sportEventId: sportEvent.id, status: sportEvent.status },
      },
      'Skipping live-score persistence — the event is not in progress',
    );
    return {
      updatesReturned,
      updatesPersisted: 0,
      updatesSkipped: updatesReturned,
      writeDiagnostics: emptySyncWriteDiagnostics(),
    };
  }

  // The event's scoring family writes the batch into its own result rows (#606), and only a
  // batch of the one category it accepts: a family entered by an admin accepts none.
  const writer = deps.scoringFamilyForEvent({
    sport: sportEvent.sport,
    scoringFamily: sportEvent.eventSeries.sportLeague.scoringFamily ?? undefined,
  }).liveScores;
  const acceptedCategory = writer?.category ?? null;
  const target: LiveScoreTargetEvent = {
    id: sportEvent.id,
    rounds: sportEvent.rounds,
    roundSeriesLengths: sportEvent.eventSeries.sportLeague.roundSeriesLengths,
  };
  const write = writer === null ? null : writeFor(writer, deps, target, validated);
  if (write === null) {
    deps.logger?.warn(
      {
        action: 'liveScore.publish.categoryNotAccepted',
        data: {
          providerId: deps.providerId,
          externalEventId: validated.externalEventId,
          sportEventId: sportEvent.id,
          sport: sportEvent.sport,
          category: validated.category,
          acceptedCategory,
        },
      },
      'Skipping live-score persistence — the event\'s scoring family does not accept this live-score category',
    );
    return {
      updatesReturned,
      updatesPersisted: 0,
      updatesSkipped: updatesReturned,
      writeDiagnostics: emptySyncWriteDiagnostics(),
    };
  }
  try {
    return await write();
  } finally {
    deps.fieldCache?.forget(sportEvent.id);
  }
}

/**
 * The family writer's write of this batch, or null when the writer takes another category. Each
 * pair is narrowed together, so a writer is only ever handed the result it is typed for.
 */
function writeFor(
  writer: LiveScoreWriter,
  deps: LiveScoreWriteDeps,
  event: LiveScoreTargetEvent,
  result: LiveScoreResult,
): (() => Promise<LiveScorePersistenceResult>) | null {
  if (writer.category === 'GOLF' && result.category === 'GOLF') return () => writer.persist(deps, event, result);
  if (writer.category === 'GAME' && result.category === 'GAME') return () => writer.persist(deps, event, result);
  return null;
}


