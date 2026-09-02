/**
 * GolfScoreService — golf round-score persistence, plans/124 §3.1/§4.10/§5.2.
 *
 * `persistRoundUpdatesForSportEvent` is `score-publisher.ts`'s former
 * `persistGolfRounds`/`refreshGolfStandings`, moved here verbatim — same
 * resolution behavior (participantExternalId -> ParticipantProviderMapping
 * -> SportEventParticipant, batched), same round-schedule auto-create
 * fallback, same standings refresh. `score-publisher.ts` now calls this
 * method instead of holding the logic itself.
 *
 * The admin score-correction surface (`getRoundScores`/`previewRoundScores`/
 * `applyRoundScores`/`updateRoundScore`) is new. `resolveFieldParticipant`
 * is its row resolver: `participantId` -> `externalId` (against the bare
 * `Participant.externalId` field, not a provider mapping — the admin CSV/
 * JSON upload path has no provider context) -> exact case-insensitive
 * `playerName` match within this tournament's field, ambiguous if more than
 * one matches. Folding this same fallback into the sync path's batched
 * resolution is deliberately deferred, not part of this extraction: a
 * behavior change to the live-scoring sync path can't be verified without a
 * live database, which this sandbox doesn't have.
 */

import { randomUUID } from 'node:crypto';
import { PrismaGolfLiveStatus, type PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { eventBus } from '@poolmaster/shared/events/event-bus';
import type { LiveScorePersistedEvent } from '@poolmaster/shared/events';
import type { GolfRoundUpdate } from '@poolmaster/shared/dto';
import type { SyncWriteDetailRow, SyncWriteDiagnostics } from '../ingestion/core/sync-write-diagnostics';
import { emptySyncWriteDiagnostics, mergeSyncWriteDiagnostics, summarizeSyncWriteRows } from '../ingestion/core/sync-write-diagnostics';

export class GolfScoreError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'GolfScoreError';
  }
}

export interface GolfRoundPersistenceResult {
  updatesReturned: number;
  updatesPersisted: number;
  updatesSkipped: number;
  writeDiagnostics: SyncWriteDiagnostics;
}

export type GolfRoundStatus = GolfRoundUpdate['status'];

export interface GolfScoreRowInput {
  participantId?: string;
  externalId?: string;
  playerName?: string;
  strokes: number | null;
  scoreToPar: number;
  thru?: number;
  status: GolfRoundStatus;
  completedAt?: string;
}

export type GolfScoreResolution = 'MATCHED' | 'UNRESOLVED' | 'AMBIGUOUS';
export type GolfScoreChange = 'CREATE' | 'UPDATE' | 'UNCHANGED';

export interface GolfRoundValues {
  strokes: number | null;
  scoreToPar: number;
  thru: number | null;
  status: GolfRoundStatus;
}

export interface GolfScorePreviewRow {
  row: GolfScoreRowInput;
  resolution: GolfScoreResolution;
  sportEventParticipantId: string | null;
  participantName: string | null;
  change: GolfScoreChange;
  before: GolfRoundValues | null;
  after: GolfRoundValues;
}

export interface GolfRoundScoreRow {
  sportEventParticipantId: string;
  participantId: string;
  participantName: string;
  strokes: number | null;
  scoreToPar: number | null;
  thru: number | null;
  status: GolfRoundStatus | null;
  completedAt: Date | null;
  standing: {
    eventScoreToPar: number;
    eventStrokes: number;
    currentRound: number | null;
    currentRoundThru: number | null;
    status: PrismaGolfLiveStatus;
  } | null;
}

export class GolfScoreService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
    private readonly bus: typeof eventBus = eventBus,
  ) {}

  // ===========================================================================
  // Sync path — moved verbatim from score-publisher.ts's persistGolfRounds.
  // ===========================================================================

  async persistRoundUpdatesForSportEvent(
    sportEventId: string,
    rounds: readonly GolfRoundUpdate[],
    providerId: string,
  ): Promise<GolfRoundPersistenceResult> {
    if (rounds.length === 0) {
      return {
        updatesReturned: 0,
        updatesPersisted: 0,
        updatesSkipped: 0,
        writeDiagnostics: emptySyncWriteDiagnostics(),
      };
    }

    // Resolve round: number -> SportEventRound.id. Every admin-managed
    // tournament gets its SportEventRound rows from ensureSportEventRounds
    // at creation time — but a provider-synced event that never went
    // through admin creation has zero SportEventRound rows until
    // plans/125 retires that ingestion path, so resolution here
    // auto-creates any missing one rather than silently dropping every
    // live score for that event.
    const sportEventRounds = await this.prisma.sportEventRound.findMany({
      where: { sportEventId },
      select: { id: true, roundNumber: true },
    });
    const roundIdByNumber = new Map(sportEventRounds.map((r) => [r.roundNumber, r.id]));
    const referencedRoundNumbers = Array.from(new Set(rounds.map((r) => r.round)));
    const missingRoundNumbers = referencedRoundNumbers.filter((roundNumber) => !roundIdByNumber.has(roundNumber));
    if (missingRoundNumbers.length > 0) {
      const createdRounds = await Promise.all(
        missingRoundNumbers.map((roundNumber) =>
          this.prisma.sportEventRound.upsert({
            where: { sportEventId_roundNumber: { sportEventId, roundNumber } },
            create: { sportEventId, roundNumber, scheduledDate: new Date() },
            update: {},
            select: { id: true, roundNumber: true },
          }),
        ),
      );
      for (const created of createdRounds) {
        roundIdByNumber.set(created.roundNumber, created.id);
      }
      this.logger?.warn(
        {
          action: 'liveScore.golf.autoCreatedRoundSchedule',
          data: { sportEventId, roundNumbers: missingRoundNumbers },
        },
        'Auto-created missing SportEventRound row(s) for a provider-synced event with no admin-created round schedule',
      );
    }

    // Resolve participantExternalId -> SportEventParticipant.id via
    // ParticipantProviderMapping -> SportEventParticipant scoped to this event.
    const externalIds = Array.from(new Set(rounds.map((r) => r.participantExternalId)));
    const mappings = await this.prisma.participantProviderMapping.findMany({
      where: { providerId, externalId: { in: externalIds } },
      select: { externalId: true, participantId: true },
    });
    const participantIdByExternalId = new Map(mappings.map((m) => [m.externalId, m.participantId]));

    const participantIds = Array.from(new Set(participantIdByExternalId.values()));
    const seps = participantIds.length === 0
      ? []
      : await this.prisma.sportEventParticipant.findMany({
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
      sportEventRoundId: string;
    }> = [];
    for (const round of rounds) {
      if (round.strokes === null) {
        this.logger?.debug?.(
          {
            action: 'liveScore.golf.nullStrokesSkipped',
            data: { providerId, externalId: round.participantExternalId, round: round.round },
          },
          'Skipping golf round update — provider does not expose per-round strokes',
        );
        skipped += 1;
        continue;
      }
      const participantId = participantIdByExternalId.get(round.participantExternalId);
      if (!participantId) {
        this.logger?.warn(
          {
            action: 'liveScore.golf.unmappedExternalId',
            data: { providerId, externalId: round.participantExternalId },
          },
          'Skipping golf round update — provider participant has no internal mapping',
        );
        skipped += 1;
        continue;
      }
      const sportEventParticipantId = sepByParticipantId.get(participantId);
      if (!sportEventParticipantId) {
        this.logger?.warn(
          {
            action: 'liveScore.golf.noSportEventParticipant',
            data: { participantId, externalId: round.participantExternalId, sportEventId },
          },
          'Skipping golf round update — no SportEventParticipant row for participant in this event',
        );
        skipped += 1;
        continue;
      }
      const sportEventRoundId = roundIdByNumber.get(round.round);
      if (!sportEventRoundId) {
        this.logger?.warn(
          {
            action: 'liveScore.golf.unresolvedRoundNumber',
            data: { sportEventId, round: round.round, externalId: round.participantExternalId },
          },
          'Skipping golf round update — no SportEventRound exists for this event/roundNumber',
        );
        skipped += 1;
        continue;
      }

      persistableRounds.push({ round: { ...round, strokes: round.strokes }, sportEventParticipantId, sportEventRoundId });
    }

    const existingRoundRows = persistableRounds.length === 0
      ? []
      : await this.prisma.sportEventParticipantGolfRound.findMany({
          where: {
            OR: persistableRounds.map(({ sportEventParticipantId, sportEventRoundId }) => ({
              sportEventParticipantId,
              sportEventRoundId,
            })),
          },
        });
    const existingRoundByKey = new Map(
      existingRoundRows.map((row) => [buildGolfRoundKey(row.sportEventParticipantId, row.sportEventRoundId), row]),
    );

    for (const { round, sportEventParticipantId, sportEventRoundId } of persistableRounds) {
      const beforeRound = existingRoundByKey.get(buildGolfRoundKey(sportEventParticipantId, sportEventRoundId));
      const before = beforeRound ? normalizeGolfRoundRow(beforeRound) : undefined;
      const after = normalizeGolfRoundInput(sportEventParticipantId, sportEventRoundId, round);

      const persistedRound = await this.prisma.sportEventParticipantGolfRound.upsert({
        where: {
          sportEventParticipantId_sportEventRoundId: { sportEventParticipantId, sportEventRoundId },
        },
        create: {
          sportEventParticipantId,
          sportEventRoundId,
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
        id: `golf-round:${sportEventParticipantId}:${sportEventRoundId}`,
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

    const standingDiagnostics = await this.refreshGolfStandings([...affectedSportEventParticipantIds], standingAsOf);

    return {
      updatesReturned: rounds.length,
      updatesPersisted: persisted,
      updatesSkipped: skipped,
      writeDiagnostics: mergeSyncWriteDiagnostics([summarizeSyncWriteRows(detailRows), standingDiagnostics]),
    };
  }

  private async refreshGolfStandings(
    sportEventParticipantIds: readonly string[],
    asOf: Date,
  ): Promise<SyncWriteDiagnostics> {
    if (sportEventParticipantIds.length === 0) return emptySyncWriteDiagnostics();

    const rows = await this.prisma.sportEventParticipantGolfRound.findMany({
      where: { sportEventParticipantId: { in: [...sportEventParticipantIds] } },
      orderBy: [{ sportEventParticipantId: 'asc' }, { sportEventRound: { roundNumber: 'asc' } }],
      select: {
        sportEventParticipantId: true,
        strokes: true,
        scoreToPar: true,
        thru: true,
        status: true,
        sportEventRound: { select: { roundNumber: true } },
      },
    });

    const detailRows: SyncWriteDetailRow[] = [];
    const rowsByParticipant = new Map<string, typeof rows>();
    for (const row of rows) {
      const participantRows = rowsByParticipant.get(row.sportEventParticipantId) ?? [];
      participantRows.push(row);
      rowsByParticipant.set(row.sportEventParticipantId, participantRows);
    }
    const existingStandings = await this.prisma.sportEventParticipantGolfStanding.findMany({
      where: { sportEventParticipantId: { in: [...sportEventParticipantIds] } },
    });
    const existingStandingByParticipantId = new Map(
      existingStandings.map((standing) => [standing.sportEventParticipantId, standing]),
    );

    for (const sportEventParticipantId of sportEventParticipantIds) {
      const participantRows = rowsByParticipant.get(sportEventParticipantId) ?? [];
      if (participantRows.length === 0) continue;

      const currentRound = participantRows.reduce((latest, row) => (
        row.sportEventRound.roundNumber > latest.sportEventRound.roundNumber ? row : latest
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
        currentRound: currentRound.sportEventRound.roundNumber,
        currentRoundThru,
        status,
      });

      const persistedStanding = await this.prisma.sportEventParticipantGolfStanding.upsert({
        where: { sportEventParticipantId },
        create: {
          sportEventParticipantId,
          eventScoreToPar,
          eventStrokes,
          currentRound: currentRound.sportEventRound.roundNumber,
          currentRoundThru,
          status,
          asOf,
        },
        update: {
          eventScoreToPar,
          eventStrokes,
          currentRound: currentRound.sportEventRound.roundNumber,
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

  // ===========================================================================
  // Admin score-correction surface (plans/124 §5.2).
  // ===========================================================================

  async getRoundScores(sportEventId: string, roundNumber: number): Promise<GolfRoundScoreRow[]> {
    const sportEventRound = await this.prisma.sportEventRound.findUnique({
      where: { sportEventId_roundNumber: { sportEventId, roundNumber } },
    });

    const fieldRows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId },
      orderBy: { participant: { name: 'asc' } },
      include: { participant: { select: { name: true } }, golfStanding: true },
    });

    const roundRows = sportEventRound
      ? await this.prisma.sportEventParticipantGolfRound.findMany({
          where: { sportEventRoundId: sportEventRound.id, sportEventParticipantId: { in: fieldRows.map((row) => row.id) } },
        })
      : [];
    const roundRowByParticipantId = new Map(roundRows.map((row) => [row.sportEventParticipantId, row]));

    return fieldRows.map((row) => {
      const roundRow = roundRowByParticipantId.get(row.id);
      return {
        sportEventParticipantId: row.id,
        participantId: row.participantId,
        participantName: row.participant.name,
        strokes: roundRow?.strokes ?? null,
        scoreToPar: roundRow?.scoreToPar ?? null,
        thru: roundRow?.thru ?? null,
        status: (roundRow?.status as GolfRoundStatus | undefined) ?? null,
        completedAt: roundRow?.completedAt ?? null,
        standing: row.golfStanding
          ? {
              eventScoreToPar: row.golfStanding.eventScoreToPar,
              eventStrokes: row.golfStanding.eventStrokes,
              currentRound: row.golfStanding.currentRound,
              currentRoundThru: row.golfStanding.currentRoundThru,
              status: row.golfStanding.status,
            }
          : null,
      };
    });
  }

  /**
   * The shared row resolver (plans/124 §5.2 "one resolver, both consumers"
   * — admin half): participantId (direct) -> externalId (against the bare
   * Participant.externalId field) -> exact case-insensitive playerName
   * match within this tournament's current field, ambiguous if more than
   * one matches.
   */
  async resolveFieldParticipant(
    row: { participantId?: string; externalId?: string; playerName?: string },
    context: { sportEventId: string },
  ): Promise<{
    resolution: GolfScoreResolution;
    sportEventParticipantId: string | null;
    participantName: string | null;
  }> {
    if (row.participantId) {
      const sep = await this.prisma.sportEventParticipant.findUnique({
        where: { sportEventId_participantId: { sportEventId: context.sportEventId, participantId: row.participantId } },
        include: { participant: { select: { name: true } } },
      });
      return sep
        ? { resolution: 'MATCHED', sportEventParticipantId: sep.id, participantName: sep.participant.name }
        : { resolution: 'UNRESOLVED', sportEventParticipantId: null, participantName: null };
    }

    if (row.externalId) {
      const participant = await this.prisma.participant.findFirst({ where: { externalId: row.externalId } });
      if (!participant) {
        return { resolution: 'UNRESOLVED', sportEventParticipantId: null, participantName: null };
      }
      const sep = await this.prisma.sportEventParticipant.findUnique({
        where: { sportEventId_participantId: { sportEventId: context.sportEventId, participantId: participant.id } },
        include: { participant: { select: { name: true } } },
      });
      return sep
        ? { resolution: 'MATCHED', sportEventParticipantId: sep.id, participantName: sep.participant.name }
        : { resolution: 'UNRESOLVED', sportEventParticipantId: null, participantName: null };
    }

    if (row.playerName) {
      const matches = await this.prisma.sportEventParticipant.findMany({
        where: { sportEventId: context.sportEventId, participant: { name: { equals: row.playerName, mode: 'insensitive' } } },
        include: { participant: { select: { name: true } } },
      });
      if (matches.length === 1) {
        return { resolution: 'MATCHED', sportEventParticipantId: matches[0].id, participantName: matches[0].participant.name };
      }
      return {
        resolution: matches.length > 1 ? 'AMBIGUOUS' : 'UNRESOLVED',
        sportEventParticipantId: null,
        participantName: null,
      };
    }

    return { resolution: 'UNRESOLVED', sportEventParticipantId: null, participantName: null };
  }

  /** Dry run — resolves every row and reports the change it would make. Writes nothing. */
  async previewRoundScores(
    sportEventId: string,
    roundNumber: number,
    rows: GolfScoreRowInput[],
  ): Promise<GolfScorePreviewRow[]> {
    const sportEventRound = await this.prisma.sportEventRound.findUnique({
      where: { sportEventId_roundNumber: { sportEventId, roundNumber } },
    });
    const existingByParticipantId = sportEventRound
      ? new Map((await this.prisma.sportEventParticipantGolfRound.findMany({
          where: { sportEventRoundId: sportEventRound.id, sportEventParticipant: { sportEventId } },
        })).map((row) => [row.sportEventParticipantId, { ...row, status: row.status as GolfRoundStatus }]))
      : new Map<string, { strokes: number; scoreToPar: number; thru: number | null; status: GolfRoundStatus }>();

    return Promise.all(rows.map(async (row) => {
      const resolved = await this.resolveFieldParticipant(row, { sportEventId });
      const after: GolfRoundValues = { strokes: row.strokes, scoreToPar: row.scoreToPar, thru: row.thru ?? null, status: row.status };

      if (resolved.resolution !== 'MATCHED' || !resolved.sportEventParticipantId) {
        return {
          row,
          resolution: resolved.resolution,
          sportEventParticipantId: null,
          participantName: null,
          change: 'CREATE' as GolfScoreChange,
          before: null,
          after,
        };
      }

      const existing = existingByParticipantId.get(resolved.sportEventParticipantId);
      const before: GolfRoundValues | null = existing
        ? { strokes: existing.strokes, scoreToPar: existing.scoreToPar, thru: existing.thru, status: existing.status }
        : null;
      const change: GolfScoreChange = !before ? 'CREATE' : golfRoundValuesEqual(before, after) ? 'UNCHANGED' : 'UPDATE';

      return {
        row,
        resolution: 'MATCHED' as GolfScoreResolution,
        sportEventParticipantId: resolved.sportEventParticipantId,
        participantName: resolved.participantName,
        change,
        before,
        after,
      };
    }));
  }

  /**
   * Applies a previewed upload — all-or-nothing (422 when any row is
   * unresolved). Refreshes standings and publishes live_score.persisted
   * exactly as the ingestion path does.
   */
  async applyRoundScores(
    sportEventId: string,
    roundNumber: number,
    rows: GolfScoreRowInput[],
  ): Promise<GolfRoundScoreRow[]> {
    const preview = await this.previewRoundScores(sportEventId, roundNumber, rows);
    const unresolved = preview.filter((p) => p.resolution !== 'MATCHED' || !p.sportEventParticipantId);
    if (unresolved.length > 0) {
      throw new GolfScoreError(
        `${unresolved.length} round score row(s) could not be resolved to a golfer.`,
        'ROUND_SCORE_ROWS_UNRESOLVED',
        422,
      );
    }

    const sportEventRound = await this.prisma.sportEventRound.upsert({
      where: { sportEventId_roundNumber: { sportEventId, roundNumber } },
      create: { sportEventId, roundNumber, scheduledDate: new Date() },
      update: {},
    });

    // strokes is NOT NULL at the storage layer — a row with no strokes has
    // nothing to persist, matching the sync path's null-strokes skip.
    const persistable = preview.filter((p) => p.row.strokes !== null);
    const asOf = new Date();
    if (persistable.length > 0) {
      await this.prisma.$transaction(
        persistable.map((p) => this.prisma.sportEventParticipantGolfRound.upsert({
          where: {
            sportEventParticipantId_sportEventRoundId: {
              sportEventParticipantId: p.sportEventParticipantId as string,
              sportEventRoundId: sportEventRound.id,
            },
          },
          create: {
            sportEventParticipantId: p.sportEventParticipantId as string,
            sportEventRoundId: sportEventRound.id,
            strokes: p.row.strokes as number,
            scoreToPar: p.row.scoreToPar,
            thru: p.row.thru ?? null,
            status: p.row.status,
            completedAt: p.row.completedAt ? new Date(p.row.completedAt) : null,
          },
          update: {
            strokes: p.row.strokes as number,
            scoreToPar: p.row.scoreToPar,
            thru: p.row.thru ?? null,
            status: p.row.status,
            completedAt: p.row.completedAt ? new Date(p.row.completedAt) : null,
          },
        })),
      );
      await this.refreshGolfStandings(persistable.map((p) => p.sportEventParticipantId as string), asOf);
    }

    const sportEvent = await this.prisma.sportEvent.findUniqueOrThrow({
      where: { id: sportEventId },
      select: { providerId: true },
    });
    const persistedEvent: LiveScorePersistedEvent = {
      id: randomUUID(),
      type: 'live_score.persisted',
      sourceService: 'ingestion-worker',
      timestamp: new Date().toISOString(),
      category: 'GOLF',
      providerId: sportEvent.providerId,
      sportEventId,
      updatesPersisted: persistable.length,
      ingestedAt: new Date().toISOString(),
    };
    await this.bus.publish('live_score.persisted', persistedEvent);

    return this.getRoundScores(sportEventId, roundNumber);
  }

  /** Single-cell correction for one participant's round result. */
  async updateRoundScore(
    sportEventId: string,
    roundNumber: number,
    sportEventParticipantId: string,
    patch: { strokes?: number; scoreToPar?: number; thru?: number | null; status?: string; completedAt?: string | null },
  ): Promise<GolfRoundScoreRow> {
    const sep = await this.prisma.sportEventParticipant.findUnique({
      where: { id: sportEventParticipantId },
      select: { id: true, sportEventId: true },
    });
    if (!sep || sep.sportEventId !== sportEventId) {
      throw new GolfScoreError(
        `Field entry ${sportEventParticipantId} was not found on sport event ${sportEventId}.`,
        'FIELD_ENTRY_NOT_FOUND',
        404,
      );
    }

    const sportEventRound = await this.prisma.sportEventRound.upsert({
      where: { sportEventId_roundNumber: { sportEventId, roundNumber } },
      create: { sportEventId, roundNumber, scheduledDate: new Date() },
      update: {},
    });

    await this.prisma.sportEventParticipantGolfRound.upsert({
      where: { sportEventParticipantId_sportEventRoundId: { sportEventParticipantId, sportEventRoundId: sportEventRound.id } },
      create: {
        sportEventParticipantId,
        sportEventRoundId: sportEventRound.id,
        strokes: patch.strokes ?? 0,
        scoreToPar: patch.scoreToPar ?? 0,
        thru: patch.thru ?? null,
        status: patch.status ?? 'IN_PROGRESS',
        completedAt: patch.completedAt ? new Date(patch.completedAt) : null,
      },
      update: {
        ...(patch.strokes !== undefined && { strokes: patch.strokes }),
        ...(patch.scoreToPar !== undefined && { scoreToPar: patch.scoreToPar }),
        ...(patch.thru !== undefined && { thru: patch.thru }),
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.completedAt !== undefined && { completedAt: patch.completedAt ? new Date(patch.completedAt) : null }),
      },
    });

    await this.refreshGolfStandings([sportEventParticipantId], new Date());

    const rows = await this.getRoundScores(sportEventId, roundNumber);
    return rows.find((row) => row.sportEventParticipantId === sportEventParticipantId) as GolfRoundScoreRow;
  }
}

function golfRoundValuesEqual(before: GolfRoundValues, after: GolfRoundValues): boolean {
  return before.strokes === after.strokes
    && before.scoreToPar === after.scoreToPar
    && before.thru === after.thru
    && before.status === after.status;
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
  sportEventRoundId: string,
  round: GolfRoundUpdate,
): Record<string, unknown> {
  return {
    sportEventParticipantId,
    sportEventRoundId,
    strokes: round.strokes,
    scoreToPar: round.scoreToPar,
    thru: round.thru ?? null,
    status: round.status,
    completedAt: round.completedAt ?? null,
  };
}

function normalizeGolfRoundRow(row: {
  sportEventParticipantId: string;
  sportEventRoundId: string;
  strokes: number;
  scoreToPar: number;
  thru: number | null;
  status: string;
  completedAt: Date | null;
}): Record<string, unknown> {
  return {
    sportEventParticipantId: row.sportEventParticipantId,
    sportEventRoundId: row.sportEventRoundId,
    strokes: row.strokes,
    scoreToPar: row.scoreToPar,
    thru: row.thru,
    status: row.status,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function buildGolfRoundKey(sportEventParticipantId: string, sportEventRoundId: string): string {
  return `${sportEventParticipantId}:${sportEventRoundId}`;
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
