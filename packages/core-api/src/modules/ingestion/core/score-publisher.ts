/**
 * Score Publisher — bus-boundary entry point for live-score updates from
 * provider adapters. Per plans/117 §10.3:
 *
 *   1. Validate the typed `LiveScoreResult` with Zod (malformed adapter
 *      payloads fail at the bus boundary, not inside the scoring consumer).
 *   2. Resolve provider-side `participantExternalId` to internal
 *      `SportEventParticipant.id` UUIDs.
 *   3. Persist the per-category detail rows (Phase 4 ships the GOLF
 *      variant; other categories throw `LiveScoreUnsupportedError`).
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
  type GolfRoundUpdate,
  type LiveScoreResult,
} from '@poolmaster/shared/dto';
import { randomUUID } from 'node:crypto';

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

/**
 * Validate, persist, and emit. Returns the number of detail rows actually
 * persisted (excludes participants whose external id couldn't be resolved
 * to a `SportEventParticipant` row, which are logged as warnings).
 */
export async function publishLiveScoreUpdate(
  result: LiveScoreResult,
  deps: LiveScorePublisherDeps,
): Promise<number> {
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
    return 0;
  }

  let updatesPersisted = 0;
  switch (validated.category) {
    case 'GOLF':
      updatesPersisted = await persistGolfRounds(
        sportEvent.id,
        validated.rounds,
        deps,
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
  const persistedEvent: LiveScorePersistedEvent = {
    id: randomUUID(),
    type: 'live_score.persisted',
    sourceService: 'ingestion-worker',
    timestamp: new Date().toISOString(),
    category: validated.category,
    providerId: deps.providerId,
    sportEventId: sportEvent.id,
    updatesPersisted,
    ingestedAt: new Date().toISOString(),
  };
  await (deps.bus ?? eventBus).publish('live_score.persisted', persistedEvent);

  return updatesPersisted;
}

async function persistGolfRounds(
  sportEventId: string,
  rounds: readonly GolfRoundUpdate[],
  deps: LiveScorePublisherDeps,
): Promise<number> {
  if (rounds.length === 0) return 0;

  // Resolve participantExternalId → SportEventParticipant.id via
  // ParticipantProviderMapping → SportEventParticipant scoped to this event.
  const externalIds = Array.from(new Set(rounds.map((r) => r.participantExternalId)));
  const mappings = await deps.prisma.participantProviderMapping.findMany({
    where: {
      providerId: deps.providerId,
      externalId: { in: externalIds },
    },
    select: { externalId: true, participantId: true },
  });
  const participantIdByExternalId = new Map(
    mappings.map((m) => [m.externalId, m.participantId]),
  );

  const participantIds = Array.from(new Set(participantIdByExternalId.values()));
  const seps = participantIds.length === 0
    ? []
    : await deps.prisma.sportEventParticipant.findMany({
        where: { participantId: { in: participantIds }, sportEventId },
        select: { id: true, participantId: true },
      });
  const sepByParticipantId = new Map<string, string>();
  for (const sep of seps) {
    sepByParticipantId.set(sep.participantId, sep.id);
  }

  let persisted = 0;
  for (const round of rounds) {
    if (round.strokes === null) {
      // Provider doesn't expose per-round strokes (mock-feed, ESPN
      // leaderboard) — persistence stays a no-op until rop.78.7 supplies
      // real strokes from PGA Tour. The DB column is NOT NULL so we
      // cannot persist scoreToPar without strokes today.
      deps.logger?.debug?.(
        {
          action: 'liveScore.golf.nullStrokesSkipped',
          data: { providerId: deps.providerId, externalId: round.participantExternalId, round: round.round },
        },
        'Skipping golf round update — provider does not expose per-round strokes',
      );
      continue;
    }
    const participantId = participantIdByExternalId.get(round.participantExternalId);
    if (!participantId) {
      deps.logger?.warn(
        {
          action: 'liveScore.golf.unmappedExternalId',
          data: { providerId: deps.providerId, externalId: round.participantExternalId },
        },
        'Skipping golf round update — provider participant has no internal mapping',
      );
      continue;
    }
    const sportEventParticipantId = sepByParticipantId.get(participantId);
    if (!sportEventParticipantId) {
      deps.logger?.warn(
        {
          action: 'liveScore.golf.noSportEventParticipant',
          data: { participantId, externalId: round.participantExternalId, sportEventId },
        },
        'Skipping golf round update — no SportEventParticipant row for participant in this event',
      );
      continue;
    }

    await deps.prisma.sportEventParticipantGolfRound.upsert({
      where: {
        sportEventParticipantId_round: {
          sportEventParticipantId,
          round: round.round,
        },
      },
      create: {
        sportEventParticipantId,
        round: round.round,
        strokes: round.strokes,
        scoreToPar: round.scoreToPar,
        status: round.status,
        completedAt: round.completedAt ? new Date(round.completedAt) : null,
      },
      update: {
        strokes: round.strokes,
        scoreToPar: round.scoreToPar,
        status: round.status,
        completedAt: round.completedAt ? new Date(round.completedAt) : null,
      },
    });
    persisted += 1;
  }

  return persisted;
}
