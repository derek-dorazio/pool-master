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

  // 2/3. Persist per category.
  let updatesPersisted = 0;
  switch (validated.category) {
    case 'GOLF':
      updatesPersisted = await persistGolfRounds(
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

  // 4. Emit typed bus event.
  const persistedEvent: LiveScorePersistedEvent = {
    id: randomUUID(),
    type: 'live_score.persisted',
    sourceService: 'ingestion-worker',
    timestamp: new Date().toISOString(),
    category: validated.category,
    providerId: deps.providerId,
    updatesPersisted,
    ingestedAt: new Date().toISOString(),
  };
  await (deps.bus ?? eventBus).publish('live_score.persisted', persistedEvent);

  return updatesPersisted;
}

async function persistGolfRounds(
  rounds: readonly GolfRoundUpdate[],
  deps: LiveScorePublisherDeps,
): Promise<number> {
  if (rounds.length === 0) return 0;

  // Resolve participantExternalId → SportEventParticipant.id via
  // ParticipantProviderMapping → SportEventParticipant.
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

  // For each (participantId), find the SportEventParticipant row(s). The
  // event scope is implicit via the contest's sport-event; we resolve the
  // SEP by participantId, picking the most recent row when ambiguous.
  const participantIds = Array.from(new Set(participantIdByExternalId.values()));
  const seps = participantIds.length === 0
    ? []
    : await deps.prisma.sportEventParticipant.findMany({
        where: { participantId: { in: participantIds } },
        select: { id: true, participantId: true, sportEventId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
  const sepByParticipantId = new Map<string, string>();
  for (const sep of seps) {
    if (!sepByParticipantId.has(sep.participantId)) {
      sepByParticipantId.set(sep.participantId, sep.id);
    }
  }

  let persisted = 0;
  for (const round of rounds) {
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
          data: { participantId, externalId: round.participantExternalId },
        },
        'Skipping golf round update — no SportEventParticipant row for participant',
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
