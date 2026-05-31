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

import { PrismaGolfLiveStatus, type PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { eventBus } from '@poolmaster/shared/events/event-bus';
import type { LiveScorePersistedEvent } from '@poolmaster/shared/events';
import {
  LiveScoreResultSchema,
  type GolfRoundUpdate,
  type LiveScoreResult,
} from '@poolmaster/shared/dto';
import { randomUUID } from 'node:crypto';
import type { SyncWriteDetailRow, SyncWriteDiagnostics } from './sync-write-diagnostics';
import { emptySyncWriteDiagnostics, mergeSyncWriteDiagnostics, summarizeSyncWriteRows } from './sync-write-diagnostics';

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
      persistenceResult = await persistGolfRounds(
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

async function persistGolfRounds(
  sportEventId: string,
  rounds: readonly GolfRoundUpdate[],
  deps: LiveScorePublisherDeps,
): Promise<LiveScorePersistenceResult> {
  if (rounds.length === 0) {
    return {
      updatesReturned: 0,
      updatesPersisted: 0,
      updatesSkipped: 0,
      writeDiagnostics: emptySyncWriteDiagnostics(),
    };
  }

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
  let skipped = 0;
  const affectedSportEventParticipantIds = new Set<string>();
  const detailRows: SyncWriteDetailRow[] = [];
  const standingAsOf = new Date();
  const persistableRounds: Array<{
    round: GolfRoundUpdate & { strokes: number };
    sportEventParticipantId: string;
  }> = [];
  for (const round of rounds) {
    if (round.strokes === null) {
      // Some providers expose only cumulative score-to-par. The DB column is
      // NOT NULL, so we skip the row rather than inventing strokes.
      deps.logger?.debug?.(
        {
          action: 'liveScore.golf.nullStrokesSkipped',
          data: { providerId: deps.providerId, externalId: round.participantExternalId, round: round.round },
        },
        'Skipping golf round update — provider does not expose per-round strokes',
      );
      skipped += 1;
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
      skipped += 1;
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
      skipped += 1;
      continue;
    }

    persistableRounds.push({ round: { ...round, strokes: round.strokes }, sportEventParticipantId });
  }

  const existingRoundRows = persistableRounds.length === 0
    ? []
    : await deps.prisma.sportEventParticipantGolfRound.findMany({
        where: {
          OR: persistableRounds.map(({ round, sportEventParticipantId }) => ({
            sportEventParticipantId,
            round: round.round,
          })),
        },
      });
  const existingRoundByKey = new Map(
    existingRoundRows.map((row) => [buildGolfRoundKey(row.sportEventParticipantId, row.round), row]),
  );

  for (const { round, sportEventParticipantId } of persistableRounds) {
    const beforeRound = existingRoundByKey.get(buildGolfRoundKey(sportEventParticipantId, round.round));
    const before = beforeRound ? normalizeGolfRoundRow(beforeRound) : undefined;
    const after = normalizeGolfRoundInput(sportEventParticipantId, round);

    const persistedRound = await deps.prisma.sportEventParticipantGolfRound.upsert({
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
        thru: round.thru ?? null,
        status: round.status,
        completedAt: round.completedAt ? new Date(round.completedAt) : null,
      },
      update: {
        strokes: round.strokes,
        scoreToPar: round.scoreToPar,
        thru: round.thru ?? null,
        status: round.status,
        completedAt: round.completedAt ? new Date(round.completedAt) : null,
      },
    });
    detailRows.push({
      id: `golf-round:${sportEventParticipantId}:${round.round}`,
      entityType: 'SportEventParticipantGolfRound',
      disposition: resolveDisposition(before, after),
      participantExternalId: round.participantExternalId,
      internalId: persistedRound.id,
      ...(before ? { before } : {}),
      after,
    });
    affectedSportEventParticipantIds.add(sportEventParticipantId);
    persisted += 1;
  }

  const standingDiagnostics = await refreshGolfStandings([...affectedSportEventParticipantIds], deps, standingAsOf);

  return {
    updatesReturned: rounds.length,
    updatesPersisted: persisted,
    updatesSkipped: skipped,
    writeDiagnostics: mergeSyncWriteDiagnostics([
      summarizeSyncWriteRows(detailRows),
      standingDiagnostics,
    ]),
  };
}

async function refreshGolfStandings(
  sportEventParticipantIds: readonly string[],
  deps: LiveScorePublisherDeps,
  asOf: Date,
): Promise<SyncWriteDiagnostics> {
  if (sportEventParticipantIds.length === 0) return emptySyncWriteDiagnostics();

  const rows = await deps.prisma.sportEventParticipantGolfRound.findMany({
    where: { sportEventParticipantId: { in: [...sportEventParticipantIds] } },
    orderBy: [{ sportEventParticipantId: 'asc' }, { round: 'asc' }],
    select: {
      sportEventParticipantId: true,
      round: true,
      strokes: true,
      scoreToPar: true,
      thru: true,
      status: true,
    },
  });

  const detailRows: SyncWriteDetailRow[] = [];
  const rowsByParticipant = new Map<string, typeof rows>();
  for (const row of rows) {
    const participantRows = rowsByParticipant.get(row.sportEventParticipantId) ?? [];
    participantRows.push(row);
    rowsByParticipant.set(row.sportEventParticipantId, participantRows);
  }
  const existingStandings = await deps.prisma.sportEventParticipantGolfStanding.findMany({
    where: { sportEventParticipantId: { in: [...sportEventParticipantIds] } },
  });
  const existingStandingByParticipantId = new Map(
    existingStandings.map((standing) => [standing.sportEventParticipantId, standing]),
  );

  for (const sportEventParticipantId of sportEventParticipantIds) {
    const participantRows = rowsByParticipant.get(sportEventParticipantId) ?? [];
    if (participantRows.length === 0) continue;

    const currentRound = participantRows.reduce((latest, row) => (
      row.round > latest.round ? row : latest
    ));
    const eventScoreToPar = participantRows.reduce((sum, row) => sum + row.scoreToPar, 0);
    const eventStrokes = participantRows.reduce((sum, row) => sum + row.strokes, 0);
    const currentRoundThru = currentRound.thru ?? (currentRound.status === 'COMPLETED' ? 18 : null);
    const status = mapGolfLiveStatus(currentRound.status);

    const existingStanding = existingStandingByParticipantId.get(sportEventParticipantId);
    const before = existingStanding ? normalizeGolfStandingRow(existingStanding) : undefined;
    const after = normalizeGolfStandingInput({
      sportEventParticipantId,
      eventScoreToPar,
      eventStrokes,
      currentRound: currentRound.round,
      currentRoundThru,
      status,
    });

    const persistedStanding = await deps.prisma.sportEventParticipantGolfStanding.upsert({
      where: { sportEventParticipantId },
      create: {
        sportEventParticipantId,
        eventScoreToPar,
        eventStrokes,
        currentRound: currentRound.round,
        currentRoundThru,
        status,
        asOf,
      },
      update: {
        eventScoreToPar,
        eventStrokes,
        currentRound: currentRound.round,
        currentRoundThru,
        status,
        asOf,
      },
    });
    detailRows.push({
      id: `golf-standing:${sportEventParticipantId}`,
      entityType: 'SportEventParticipantGolfStanding',
      disposition: resolveDisposition(before, after),
      internalId: persistedStanding.id,
      ...(before ? { before } : {}),
      after,
    });
  }

  return summarizeSyncWriteRows(detailRows);
}

function mapGolfLiveStatus(roundStatus: string): PrismaGolfLiveStatus {
  switch (roundStatus) {
    case 'IN_PROGRESS':
      return PrismaGolfLiveStatus.IN_PROGRESS;
    case 'COMPLETED':
      return PrismaGolfLiveStatus.COMPLETE;
    case 'DNF':
    case 'DSQ':
      return PrismaGolfLiveStatus.WITHDRAWN;
    case 'MISSED_CUT':
      return PrismaGolfLiveStatus.MISSED_CUT;
    default:
      return PrismaGolfLiveStatus.ACTIVE;
  }
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

function resolveDisposition(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): SyncWriteDetailRow['disposition'] {
  if (!before) {
    return 'CREATED';
  }

  return stableJson(before) === stableJson(after) ? 'UNCHANGED' : 'UPDATED';
}

function normalizeGolfRoundInput(
  sportEventParticipantId: string,
  round: GolfRoundUpdate,
): Record<string, unknown> {
  return {
    sportEventParticipantId,
    round: round.round,
    strokes: round.strokes,
    scoreToPar: round.scoreToPar,
    thru: round.thru ?? null,
    status: round.status,
    completedAt: round.completedAt ?? null,
  };
}

function normalizeGolfRoundRow(row: {
  sportEventParticipantId: string;
  round: number;
  strokes: number;
  scoreToPar: number;
  thru: number | null;
  status: string;
  completedAt: Date | null;
}): Record<string, unknown> {
  return {
    sportEventParticipantId: row.sportEventParticipantId,
    round: row.round,
    strokes: row.strokes,
    scoreToPar: row.scoreToPar,
    thru: row.thru,
    status: row.status,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function buildGolfRoundKey(sportEventParticipantId: string, round: number): string {
  return `${sportEventParticipantId}:${round}`;
}

function normalizeGolfStandingInput(input: {
  sportEventParticipantId: string;
  eventScoreToPar: number;
  eventStrokes: number;
  currentRound: number | null;
  currentRoundThru: number | null;
  status: PrismaGolfLiveStatus;
}): Record<string, unknown> {
  // `asOf` is intentionally excluded from write diagnostics. It advances on
  // every poll, but member-visible standing values are unchanged when score,
  // round, thru, and status match the prior standing row.
  return {
    sportEventParticipantId: input.sportEventParticipantId,
    eventScoreToPar: input.eventScoreToPar,
    eventStrokes: input.eventStrokes,
    currentRound: input.currentRound,
    currentRoundThru: input.currentRoundThru,
    status: input.status,
  };
}

function normalizeGolfStandingRow(row: {
  sportEventParticipantId: string;
  eventScoreToPar: number;
  eventStrokes: number;
  currentRound: number | null;
  currentRoundThru: number | null;
  status: PrismaGolfLiveStatus;
}): Record<string, unknown> {
  return {
    sportEventParticipantId: row.sportEventParticipantId,
    eventScoreToPar: row.eventScoreToPar,
    eventStrokes: row.eventStrokes,
    currentRound: row.currentRound,
    currentRoundThru: row.currentRoundThru,
    status: row.status,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}
