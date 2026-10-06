/**
 * GolfScoreService — golf round-score persistence, plans/124 §3.1/§4.10/§5.2.
 *
 * Two writers, one storage path. `persistRoundUpdatesForSportEvent` is the provider sync
 * (score-publisher.ts): participantExternalId → provider mapping → the event's field row,
 * with a missing round auto-created on a provider-owned (FULL) event and skipped on an
 * admin-owned one (#118), then the standings refreshed. The admin correction
 * surface — preview, apply, single-cell update — resolves each uploaded row against the
 * event's field with the shared participant-row resolver, the same precedence a sport
 * league's affiliation upload uses (#236; each had its own copy before).
 *
 * Every write goes through the golf extension ports, which write a core row and its golf
 * row together (#235 split them). This service keeps its golf name: it writes golf rows.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { GolfRoundUpdate } from '@poolmaster/shared/dto';
import type {
  GolfRoundWrite,
  ParticipantProviderMappingRepository,
  ParticipantRepository,
  SportEventParticipantGolfRoundRepository,
  SportEventParticipantGolfStandingRepository,
  SportEventParticipantRepository,
  SportEventRoundRepository,
} from '@poolmaster/shared/db';
import {
  compareScores,
  PARTICIPANT_SCORING_DEFINITIONS,
  ParticipantStandingStatus,
  rankSortedScores,
  SportEventSyncScope,
  type GolfRoundResult,
  type GolfStandingResult,
} from '@poolmaster/shared/domain';
import type { SyncWriteDetailRow, SyncWriteDiagnostics } from '../ingestion/core/sync-write-diagnostics';
import { emptySyncWriteDiagnostics, mergeSyncWriteDiagnostics, summarizeSyncWriteRows } from '../ingestion/core/sync-write-diagnostics';
import { matchAmong, resolveParticipantRow, type ParticipantRowResolution } from '../sport-catalog/participant-row-resolver';

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

export type GolfScoreResolution = ParticipantRowResolution;
export type GolfScoreChange = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'SKIPPED';

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

export interface GolfRoundScorePatch {
  strokes?: number;
  scoreToPar?: number;
  thru?: number | null;
  status?: string;
  completedAt?: string | null;
}

export interface GolfScoreServiceDeps {
  rounds: SportEventRoundRepository;
  field: SportEventParticipantRepository;
  participants: ParticipantRepository;
  mappings: ParticipantProviderMappingRepository;
  golfRounds: SportEventParticipantGolfRoundRepository;
  golfStandings: SportEventParticipantGolfStandingRepository;
  logger?: FastifyBaseLogger;
}

export class GolfScoreService {
  constructor(private readonly deps: GolfScoreServiceDeps) {}

  // ===========================================================================
  // Sync path (score-publisher.ts).
  // ===========================================================================

  async persistRoundUpdatesForSportEvent(
    sportEventId: string,
    rounds: readonly GolfRoundUpdate[],
    providerId: string,
    syncScope: SportEventSyncScope,
  ): Promise<GolfRoundPersistenceResult> {
    if (rounds.length === 0) {
      return { updatesReturned: 0, updatesPersisted: 0, updatesSkipped: 0, writeDiagnostics: emptySyncWriteDiagnostics() };
    }
    const { logger } = this.deps;

    // A provider-owned (FULL) event has no admin schedule, so a score for a round the event
    // lacks creates it rather than being dropped. An admin-owned event (SCORES_ONLY, NONE)
    // keeps the rounds its admin scheduled: a round number beyond them is skipped (#118).
    // Golf playoff holes are not a round and never count toward a score.
    const roundIdByNumber = new Map((await this.deps.rounds.findBySportEvent(sportEventId)).map((round) => [round.roundNumber, round.id]));
    const missingRoundNumbers = [...new Set(rounds.map((round) => round.round))].filter((roundNumber) => !roundIdByNumber.has(roundNumber));
    if (missingRoundNumbers.length > 0 && syncScope === SportEventSyncScope.FULL) {
      const created = await Promise.all(missingRoundNumbers.map((roundNumber) => this.deps.rounds.findOrCreate(sportEventId, roundNumber)));
      for (const round of created) {
        roundIdByNumber.set(round.roundNumber, round.id);
      }
      logger?.warn(
        { action: 'liveScore.golf.autoCreatedRoundSchedule', data: { sportEventId, roundNumbers: missingRoundNumbers } },
        'Auto-created missing SportEventRound row(s) for a provider-synced event with no admin-created round schedule',
      );
    } else if (missingRoundNumbers.length > 0) {
      logger?.warn(
        { action: 'liveScore.golf.unscheduledRoundSkipped', data: { sportEventId, roundNumbers: missingRoundNumbers } },
        'Skipping golf round update(s) for round(s) the admin did not schedule on this event',
      );
    }

    const externalIds = [...new Set(rounds.map((round) => round.participantExternalId))];
    const participantIdByExternalId = new Map(
      (await this.deps.mappings.findByProviderExternalIds(providerId, externalIds)).map((mapping) => [mapping.externalId, mapping.participantId]),
    );
    const entryIdByParticipantId = new Map(
      (await this.deps.field.findBySportEvent(sportEventId)).map((entry) => [entry.participantId, entry.id]),
    );

    let skipped = 0;
    const persistable: Array<{ round: GolfRoundUpdate & { strokes: number }; sportEventParticipantId: string; sportEventRoundId: string }> = [];
    for (const round of rounds) {
      if (round.strokes === null) {
        logger?.debug?.(
          { action: 'liveScore.golf.nullStrokesSkipped', data: { providerId, externalId: round.participantExternalId, round: round.round } },
          'Skipping golf round update — provider does not expose per-round strokes',
        );
        skipped += 1;
        continue;
      }
      const participantId = participantIdByExternalId.get(round.participantExternalId);
      if (!participantId) {
        logger?.warn(
          { action: 'liveScore.golf.unmappedExternalId', data: { providerId, externalId: round.participantExternalId } },
          'Skipping golf round update — provider participant has no internal mapping',
        );
        skipped += 1;
        continue;
      }
      const sportEventParticipantId = entryIdByParticipantId.get(participantId);
      if (!sportEventParticipantId) {
        logger?.warn(
          { action: 'liveScore.golf.noSportEventParticipant', data: { participantId, externalId: round.participantExternalId, sportEventId } },
          'Skipping golf round update — no SportEventParticipant row for participant in this event',
        );
        skipped += 1;
        continue;
      }
      const sportEventRoundId = roundIdByNumber.get(round.round);
      if (!sportEventRoundId) {
        if (missingRoundNumbers.includes(round.round)) {
          // Logged once above, with every unscheduled round number.
          skipped += 1;
          continue;
        }
        logger?.warn(
          { action: 'liveScore.golf.unresolvedRoundNumber', data: { sportEventId, round: round.round, externalId: round.participantExternalId } },
          'Skipping golf round update — no SportEventRound exists for this event/roundNumber',
        );
        skipped += 1;
        continue;
      }
      persistable.push({ round: { ...round, strokes: round.strokes }, sportEventParticipantId, sportEventRoundId });
    }

    const existingByKey = new Map(
      (await this.deps.golfRounds.findBySportEventParticipants([...new Set(persistable.map((entry) => entry.sportEventParticipantId))]))
        .map((result) => [buildGolfRoundKey(result.participantRound.sportEventParticipantId, result.participantRound.sportEventRoundId), result]),
    );

    // Each golfer's round is two rows (core + golf extension), so the writes run
    // concurrently across golfers. Updates for the same (golfer, round) in one
    // payload are chained so they still apply in payload order.
    const chainByKey = new Map<string, Promise<GolfRoundResult>>();
    const written = await Promise.all(persistable.map(({ round, sportEventParticipantId, sportEventRoundId }) => {
      const key = buildGolfRoundKey(sportEventParticipantId, sportEventRoundId);
      const write = (chainByKey.get(key) ?? Promise.resolve(null)).then(() => this.deps.golfRounds.upsert({
        sportEventParticipantId,
        sportEventRoundId,
        status: round.status,
        completedAt: round.completedAt ? new Date(round.completedAt) : null,
        strokes: round.strokes,
        scoreToPar: round.scoreToPar,
        thru: round.thru ?? null,
      }));
      chainByKey.set(key, write);
      return write;
    }));

    const detailRows: SyncWriteDetailRow[] = persistable.map(({ round, sportEventParticipantId, sportEventRoundId }, index) => {
      const existing = existingByKey.get(buildGolfRoundKey(sportEventParticipantId, sportEventRoundId));
      const before = existing ? normalizeGolfRoundResult(existing) : undefined;
      const after = normalizeGolfRoundInput(sportEventParticipantId, sportEventRoundId, round);
      return {
        id: `golf-round:${sportEventParticipantId}:${sportEventRoundId}`,
        entityType: 'SportEventParticipantGolfRound',
        disposition: resolveDisposition(before, after),
        participantExternalId: round.participantExternalId,
        internalId: written[index].participantRound.id,
        ...(before ? { before } : {}),
        after,
      };
    });

    const standingDiagnostics = await this.refreshGolfStandings(
      sportEventId,
      [...new Set(persistable.map((entry) => entry.sportEventParticipantId))],
      new Date(),
    );

    return {
      updatesReturned: rounds.length,
      updatesPersisted: persistable.length,
      updatesSkipped: skipped,
      writeDiagnostics: mergeSyncWriteDiagnostics([summarizeSyncWriteRows(detailRows), standingDiagnostics]),
    };
  }

  /**
   * Recomputes each golfer's standing from all their scored rounds: the core standing
   * carries the current round, status and asOf; the golf extension the totals. Then re-ranks
   * the whole event, since one golfer's new score can move everyone's position.
   */
  private async refreshGolfStandings(
    sportEventId: string,
    sportEventParticipantIds: readonly string[],
    asOf: Date,
  ): Promise<SyncWriteDiagnostics> {
    if (sportEventParticipantIds.length === 0) return emptySyncWriteDiagnostics();
    const diagnostics = await this.writeGolfStandings(sportEventParticipantIds, asOf);
    await this.rankEventStandings(sportEventId);
    return diagnostics;
  }

  /**
   * Writes the event-side rank (#246): `position` and `displayPosition` on every golfer's core
   * standing, computed here once per score write so no reader re-derives it. The provider does
   * not supply a live rank — `finishPosition` is a past event's finish, used only for form —
   * so it is ranked from `eventScoreToPar`, lower is better, ties shown as "T3". A withdrawn or
   * eliminated (cut) golfer is unranked. Only rows whose rank changed are written.
   */
  private async rankEventStandings(sportEventId: string): Promise<void> {
    const standings = await this.deps.golfStandings.findBySportEvent(sportEventId);
    const { direction } = PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL;
    const rankedScore = (result: GolfStandingResult): number | null => (
      result.standing.status === ParticipantStandingStatus.WITHDRAWN
      || result.standing.status === ParticipantStandingStatus.ELIMINATED
        ? null
        : result.golf.eventScoreToPar
    );
    const sorted = [...standings].sort((left, right) =>
      compareScores(direction, rankedScore(left), rankedScore(right))
      || left.standing.sportEventParticipantId.localeCompare(right.standing.sportEventParticipantId),
    );
    const ranks = rankSortedScores(sorted.map(rankedScore));
    const changed = sorted.flatMap((result, index) => {
      const rank = ranks[index];
      return result.standing.position === rank.position && result.standing.displayPosition === rank.displayPosition
        ? []
        : [{ standingId: result.standing.id, ...rank }];
    });
    await this.deps.golfStandings.updateRanks(changed);
  }

  private async writeGolfStandings(sportEventParticipantIds: readonly string[], asOf: Date): Promise<SyncWriteDiagnostics> {

    const [rounds, existing] = await Promise.all([
      this.deps.golfRounds.findBySportEventParticipants(sportEventParticipantIds),
      this.deps.golfStandings.findBySportEventParticipants(sportEventParticipantIds),
    ]);
    const roundsByEntry = new Map<string, GolfRoundResult[]>();
    for (const result of rounds) {
      const list = roundsByEntry.get(result.participantRound.sportEventParticipantId) ?? [];
      list.push(result);
      roundsByEntry.set(result.participantRound.sportEventParticipantId, list);
    }
    const existingByEntry = new Map(existing.map((result) => [result.standing.sportEventParticipantId, result]));

    const plans = sportEventParticipantIds.flatMap((sportEventParticipantId) => {
      const entryRounds = roundsByEntry.get(sportEventParticipantId) ?? [];
      if (entryRounds.length === 0) return [];
      const current = entryRounds.reduce((latest, result) => (
        result.participantRound.roundNumber > latest.participantRound.roundNumber ? result : latest
      ));
      const eventScoreToPar = entryRounds.reduce((sum, result) => sum + result.golf.scoreToPar, 0);
      const eventStrokes = entryRounds.reduce((sum, result) => sum + result.golf.strokes, 0);
      const currentRoundThru = current.golf.thru ?? (current.participantRound.status === 'COMPLETED' ? 18 : null);
      const status = mapGolfLiveStatus(current.participantRound.status);
      const currentRound = current.participantRound.roundNumber;
      const before = existingByEntry.get(sportEventParticipantId);
      return [{
        write: { sportEventParticipantId, currentRound, status, asOf, eventScoreToPar, eventStrokes, currentRoundThru },
        before: before ? normalizeGolfStandingResult(before) : undefined,
        after: normalizeGolfStanding({ sportEventParticipantId, eventScoreToPar, eventStrokes, currentRound, currentRoundThru, status }),
      }];
    });

    // One standing per golfer, so the writes are independent and run concurrently.
    const written = await Promise.all(plans.map((plan) => this.deps.golfStandings.upsert(plan.write)));
    return summarizeSyncWriteRows(plans.map((plan, index) => ({
      id: `golf-standing:${plan.write.sportEventParticipantId}`,
      entityType: 'SportEventParticipantGolfStanding',
      disposition: resolveDisposition(plan.before, plan.after),
      internalId: written[index].standing.id,
      ...(plan.before ? { before: plan.before } : {}),
      after: plan.after,
    })));
  }

  // ===========================================================================
  // Admin score-correction surface (plans/124 §5.2).
  // ===========================================================================

  /** Dry run — resolves every row against the event's field and reports the change it would make. Writes nothing. */
  async previewRoundScores(sportEventId: string, roundNumber: number, rows: GolfScoreRowInput[]): Promise<GolfScorePreviewRow[]> {
    const [field, eventRounds] = await Promise.all([
      this.deps.field.findBySportEvent(sportEventId),
      this.deps.rounds.findBySportEvent(sportEventId),
    ]);
    const participants = await this.deps.participants.findByIds(field.map((entry) => entry.participantId));
    const entryIdByParticipantId = new Map(field.map((entry) => [entry.participantId, entry.id]));
    const round = eventRounds.find((candidate) => candidate.roundNumber === roundNumber);
    const existingByEntry = new Map(
      (round ? await this.deps.golfRounds.findBySportEventRound(round.id) : [])
        .map((result) => [result.participantRound.sportEventParticipantId, result]),
    );

    return Promise.all(rows.map(async (row) => {
      const resolved = await resolveParticipantRow(row, matchAmong(participants));
      const after: GolfRoundValues = { strokes: row.strokes, scoreToPar: row.scoreToPar, thru: row.thru ?? null, status: row.status };
      const sportEventParticipantId = resolved.participant ? entryIdByParticipantId.get(resolved.participant.id) ?? null : null;
      if (resolved.resolution !== 'MATCHED' || !sportEventParticipantId) {
        return { row, resolution: resolved.resolution, sportEventParticipantId: null, participantName: null, change: 'CREATE' as const, before: null, after };
      }
      const existing = existingByEntry.get(sportEventParticipantId);
      const before: GolfRoundValues | null = existing
        ? { strokes: existing.golf.strokes, scoreToPar: existing.golf.scoreToPar, thru: existing.golf.thru, status: existing.participantRound.status as GolfRoundStatus }
        : null;
      // Apply stores nothing for a row with no strokes (strokes is NOT NULL in storage).
      const change: GolfScoreChange = row.strokes === null
        ? 'SKIPPED'
        : !before ? 'CREATE' : golfRoundValuesEqual(before, after) ? 'UNCHANGED' : 'UPDATE';
      return {
        row,
        resolution: 'MATCHED' as const,
        sportEventParticipantId,
        participantName: resolved.participant?.name ?? null,
        change,
        before,
        after,
      };
    }));
  }

  /**
   * Applies a previewed upload — all or none, 422 when any row is unresolved — then
   * refreshes standings exactly as the sync path does.
   */
  async applyRoundScores(sportEventId: string, roundNumber: number, rows: GolfScoreRowInput[]): Promise<void> {
    const preview = await this.previewRoundScores(sportEventId, roundNumber, rows);
    const unresolved = preview.filter((row) => row.resolution !== 'MATCHED' || !row.sportEventParticipantId);
    if (unresolved.length > 0) {
      throw new GolfScoreError(
        `${unresolved.length} round score row(s) could not be resolved to a golfer.`,
        'ROUND_SCORE_ROWS_UNRESOLVED',
        422,
      );
    }
    const round = await this.deps.rounds.findOrCreate(sportEventId, roundNumber);

    // strokes is NOT NULL in storage: a row with no strokes has nothing to persist,
    // matching the sync path's null-strokes skip.
    const writes: GolfRoundWrite[] = preview
      .filter((row) => row.row.strokes !== null)
      .map((row) => ({
        sportEventParticipantId: row.sportEventParticipantId as string,
        sportEventRoundId: round.id,
        status: row.row.status,
        completedAt: row.row.completedAt ? new Date(row.row.completedAt) : null,
        strokes: row.row.strokes as number,
        scoreToPar: row.row.scoreToPar,
        thru: row.row.thru ?? null,
      }));
    if (writes.length > 0) {
      await this.deps.golfRounds.upsertMany(writes);
      await this.refreshGolfStandings(sportEventId, writes.map((write) => write.sportEventParticipantId), new Date());
    }
  }

  /** Single-cell correction of one golfer's round. Unpatched values keep what was recorded. */
  async updateRoundScore(sportEventId: string, roundNumber: number, sportEventParticipantId: string, patch: GolfRoundScorePatch): Promise<void> {
    const entry = await this.deps.field.findById(sportEventParticipantId);
    if (!entry || entry.sportEventId !== sportEventId) {
      throw new GolfScoreError(
        `Field row ${sportEventParticipantId} is not on sport event ${sportEventId}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    const round = await this.deps.rounds.findOrCreate(sportEventId, roundNumber);
    const existing = (await this.deps.golfRounds.findBySportEventParticipants([sportEventParticipantId]))
      .find((result) => result.participantRound.sportEventRoundId === round.id);

    await this.deps.golfRounds.upsert({
      sportEventParticipantId,
      sportEventRoundId: round.id,
      status: patch.status ?? existing?.participantRound.status ?? 'IN_PROGRESS',
      completedAt: patch.completedAt !== undefined
        ? (patch.completedAt ? new Date(patch.completedAt) : null)
        : existing?.participantRound.completedAt ?? null,
      strokes: patch.strokes ?? existing?.golf.strokes ?? 0,
      scoreToPar: patch.scoreToPar ?? existing?.golf.scoreToPar ?? 0,
      thru: patch.thru !== undefined ? patch.thru : existing?.golf.thru ?? null,
    });
    await this.refreshGolfStandings(sportEventId, [sportEventParticipantId], new Date());
  }
}

function golfRoundValuesEqual(before: GolfRoundValues, after: GolfRoundValues): boolean {
  return before.strokes === after.strokes
    && before.scoreToPar === after.scoreToPar
    && before.thru === after.thru
    && before.status === after.status;
}

function mapGolfLiveStatus(roundStatus: string): ParticipantStandingStatus {
  switch (roundStatus) {
    case 'IN_PROGRESS':
      return ParticipantStandingStatus.IN_PROGRESS;
    case 'COMPLETED':
      return ParticipantStandingStatus.COMPLETE;
    case 'DNF':
    case 'DSQ':
      return ParticipantStandingStatus.WITHDRAWN;
    case 'MISSED_CUT':
      return ParticipantStandingStatus.ELIMINATED;
    default:
      return ParticipantStandingStatus.ACTIVE;
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

function normalizeGolfRoundResult(result: GolfRoundResult): Record<string, unknown> {
  return {
    sportEventParticipantId: result.participantRound.sportEventParticipantId,
    sportEventRoundId: result.participantRound.sportEventRoundId,
    strokes: result.golf.strokes,
    scoreToPar: result.golf.scoreToPar,
    thru: result.golf.thru,
    status: result.participantRound.status,
    completedAt: result.participantRound.completedAt?.toISOString() ?? null,
  };
}

function buildGolfRoundKey(sportEventParticipantId: string, sportEventRoundId: string): string {
  return `${sportEventParticipantId}:${sportEventRoundId}`;
}

function normalizeGolfStanding(input: {
  sportEventParticipantId: string;
  eventScoreToPar: number;
  eventStrokes: number;
  currentRound: number | null;
  currentRoundThru: number | null;
  status: ParticipantStandingStatus;
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

function normalizeGolfStandingResult(result: GolfStandingResult): Record<string, unknown> {
  return normalizeGolfStanding({
    sportEventParticipantId: result.standing.sportEventParticipantId,
    eventScoreToPar: result.golf.eventScoreToPar,
    eventStrokes: result.golf.eventStrokes,
    currentRound: result.standing.currentRound,
    currentRoundThru: result.golf.currentRoundThru,
    status: result.standing.status,
  });
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
