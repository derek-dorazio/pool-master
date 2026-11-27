/**
 * Stroke-play results (#2008): each round of a golf event is one FIELD Match with every golfer
 * who played it as a side, and a golfer's round is their side result in its Game, with strokes,
 * to-par and holes thru exactly as the feed or the admin sent them. The golfer's standing holds
 * the event totals and the event-wide rank. Everything a write changes, the side results, the
 * rounds' Game statuses and the standings, goes down in one transaction through the FIELD Game
 * port.
 *
 * Two writers, one storage path. `persistRoundUpdatesForSportEvent` is the provider sync
 * (score-publisher.ts): participantExternalId → provider mapping → the event's field row, with a
 * round the event does not have skipped (#118, #435). The admin correction surface, test events
 * only (#2074): preview, apply and single-cell update, resolving each uploaded row against the
 * event's field with the shared participant-row resolver.
 *
 * Rounds come only from the event's schedule, its Round rows (#375, #2008): a sync update for a
 * round the event does not have is skipped, and an admin score for one is refused (422
 * ROUND_BEYOND_SCHEDULE). An update past the round's last hole (its slot's period count, #2047) is skipped: golf playoff holes are not a
 * round and never count toward a score. A round's Game is COMPLETED once every golfer in it has
 * finished it. A golfer's sides come only from the rounds the feed reports them in, so a cut
 * golfer simply has no side in the rounds after it.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { GolfRoundUpdate, ApiErrorCode } from '@poolmaster/shared/dto';
import type {
  FieldGameRepository,
  FieldGameWrite,
  FieldSideResult,
  FieldSideWrite,
  FieldStanding,
  FieldStandingWrite,
  ParticipantProviderMappingRepository,
  ParticipantRepository,
  SportEventParticipantRepository,
  SportEventRepository,
  SportEventRoundRepository,
} from '@poolmaster/shared/db';
import {
  compareScores,
  GameSideStatus,
  latestParticipantRound,
  MatchStatus,
  PARTICIPANT_SCORING_DEFINITIONS,
  ParticipantStandingStatus,
  rankSortedScores,
  type SportEvent,
  type SportEventRound,
  requireProviderCodeOfSourceId,
} from '@poolmaster/shared/domain';
import type { SyncWriteDetailRow, SyncWriteDiagnostics } from '../../ingestion/core/sync-write-diagnostics';
import { emptySyncWriteDiagnostics, mergeSyncWriteDiagnostics, summarizeSyncWriteRows } from '../../ingestion/core/sync-write-diagnostics';
import { feedIdsOfCandidates, matchAmong, resolveParticipantRow, type ParticipantRowResolution } from '../../sport-catalog/participant-row-resolver';
import type { ScoringFamilyEvent } from '../scoring-family-module';
import { DomainEventType, type DomainEvents } from '../../domain-events';

export class StrokePlayResultError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'StrokePlayResultError';
  }
}

export interface GolfRoundPersistenceResult {
  updatesReturned: number;
  updatesPersisted: number;
  updatesSkipped: number;
  writeDiagnostics: SyncWriteDiagnostics;
  /** The feed's participant ids no participant is mapped to (#1999): the publisher raises a finding for each. */
  unmappedExternalIds?: readonly string[];
}

export type GolfRoundStatus = GolfRoundUpdate['status'];

export interface GolfScoreRowInput {
  participantId?: string;
  externalId?: string;
  strokes: number | null;
  scoreToPar: number;
  thru?: number;
  status: GolfRoundStatus;
  /** True on the round the cut ended the golfer's event in: the standing turns ELIMINATED. */
  missedCut?: boolean;
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
  status?: GolfRoundStatus;
  missedCut?: boolean;
  completedAt?: string | null;
}

export interface StrokePlayResultServiceDeps {
  events: Pick<SportEventRepository, 'findById'>;
  rounds: SportEventRoundRepository;
  field: SportEventParticipantRepository;
  participants: ParticipantRepository;
  mappings: ParticipantProviderMappingRepository;
  fieldGames: FieldGameRepository;
  /**
   * Whether an event of this sport keeps golf round scores, by its sport's scoring family. The
   * admin corrections refuse any other event rather than write golf results onto it.
   */
  storesGolfRoundScores: (event: ScoringFamilyEvent) => boolean;
  /** What follows each results, field or game change it writes (#1946): the app's one map. */
  domainEvents: Pick<DomainEvents, 'collect'>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

/** One golfer's round as it is to be written. */
interface RoundWrite {
  sportEventParticipantId: string;
  round: SportEventRound;
  strokes: number;
  scoreToPar: number;
  thru: number | null;
  status: GolfRoundStatus;
  missedCut: boolean;
  completedAt: Date | null;
}

export class StrokePlayResultService {
  constructor(private readonly deps: StrokePlayResultServiceDeps) {}

  // ===========================================================================
  // Sync path (score-publisher.ts).
  // ===========================================================================

  async persistRoundUpdatesForSportEvent(
    sportEventId: string,
    rounds: readonly GolfRoundUpdate[],
    providerId: string,
  ): Promise<GolfRoundPersistenceResult> {
    if (rounds.length === 0) {
      return { updatesReturned: 0, updatesPersisted: 0, updatesSkipped: 0, writeDiagnostics: emptySyncWriteDiagnostics() };
    }
    const { logger } = this.deps;

    // A score for a round the event does not have is skipped: rounds come only from the event's
    // schedule, its Round rows, never from a score (#118, #375, #435, #2008).
    const reportedRoundNumbers = [...new Set(rounds.map((round) => round.round))];
    const eventRounds = await this.deps.rounds.findBySportEvent(sportEventId);
    const roundByNumber = new Map(eventRounds.map((round) => [round.roundNumber, round]));
    const missingRoundNumbers = reportedRoundNumbers.filter((roundNumber) => !roundByNumber.has(roundNumber));
    if (missingRoundNumbers.length > 0) {
      logger?.warn(
        { action: 'liveScore.golf.unscheduledRoundSkipped', data: { sportEventId, roundNumbers: missingRoundNumbers } },
        'Skipping golf round update(s) for round(s) the event does not have',
      );
    }

    const externalIds = [...new Set(rounds.map((round) => round.participantExternalId))];
    const participantIdByExternalId = new Map(
      (await this.deps.mappings.findByProviderExternalIds(requireProviderCodeOfSourceId(providerId), { sportEventId }, externalIds)).map((mapping) => [mapping.externalId, mapping.participantId]),
    );
    const entryIdByParticipantId = new Map(
      (await this.deps.field.findBySportEvent(sportEventId)).map((entry) => [entry.participantId, entry.id]),
    );

    let skipped = 0;
    const unmappedExternalIds = new Set<string>();
    const writes: Array<RoundWrite & { participantExternalId: string }> = [];
    for (const round of rounds) {
      if (missingRoundNumbers.includes(round.round)) {
        // Logged once above, with every round number skipped.
        skipped += 1;
        continue;
      }
      const eventRound = roundByNumber.get(round.round);
      // A round's holes are its slot's periods (#2047): eighteen for a golf tournament.
      const holes = eventRound?.slot.periods?.count;
      if (round.thru !== undefined && holes !== undefined && round.thru > holes) {
        // Its to-par may include playoff holes, so no part of it is stored.
        logger?.warn(
          { action: 'liveScore.golf.holeBeyondRoundSkipped', data: { sportEventId, externalId: round.participantExternalId, round: round.round, thru: round.thru, holes } },
          'Skipping golf round update — it reports holes past the round\'s last, which are a playoff and never scored',
        );
        skipped += 1;
        continue;
      }
      if (round.strokes === null) {
        logger?.debug(
          { action: 'liveScore.golf.nullStrokesSkipped', data: { providerId, externalId: round.participantExternalId, round: round.round } },
          'Skipping golf round update — provider does not expose per-round strokes',
        );
        skipped += 1;
        continue;
      }
      const participantId = participantIdByExternalId.get(round.participantExternalId);
      if (!participantId) {
        // Logged once below, with every unmapped golfer.
        unmappedExternalIds.add(round.participantExternalId);
        skipped += 1;
        continue;
      }
      const sportEventParticipantId = entryIdByParticipantId.get(participantId);
      if (!sportEventParticipantId || !eventRound) {
        logger?.warn(
          { action: 'liveScore.golf.noSportEventParticipant', data: { participantId, externalId: round.participantExternalId, sportEventId } },
          'Skipping golf round update — no SportEventParticipant row for participant in this event',
        );
        skipped += 1;
        continue;
      }
      writes.push({
        participantExternalId: round.participantExternalId,
        sportEventParticipantId,
        round: eventRound,
        strokes: round.strokes,
        scoreToPar: round.scoreToPar,
        thru: round.thru ?? null,
        status: round.status,
        missedCut: round.missedCut ?? false,
        completedAt: round.completedAt ? new Date(round.completedAt) : null,
      });
    }
    if (unmappedExternalIds.size > 0) {
      // One line a tick, not one per golfer (#1183); each is raised as a sync finding by the
      // publisher, deduplicated, from what this returns (#1999).
      logger?.warn(
        { action: 'liveScore.golf.unmappedExternalId', data: { providerId, sportEventId, externalIds: [...unmappedExternalIds] } },
        'Skipping golf round updates for provider participants with no internal mapping',
      );
    }

    // A payload can carry the same golfer's round more than once; the last one is what the
    // provider says now, so it is the one compared and written.
    const latest = [...new Map(writes.map((write) => [roundKey(write.sportEventParticipantId, write.round.roundNumber), write])).values()];
    const diagnostics = await this.writeRounds(sportEventId, latest);
    return {
      updatesReturned: rounds.length,
      // A golfer-round sent twice in one payload counts once: it is compared and written once.
      updatesPersisted: latest.length,
      updatesSkipped: skipped,
      writeDiagnostics: diagnostics,
      unmappedExternalIds: [...unmappedExternalIds],
    };
  }

  /**
   * Writes the golfers' rounds and, in the same transaction, every standing the write moves:
   * each named golfer's totals, status and the event-wide rank, which one golfer's new score can
   * change for everyone. Only the rounds and standings whose values changed are written.
   */
  private async writeRounds(
    sportEventId: string,
    writes: ReadonlyArray<RoundWrite & { participantExternalId?: string }>,
  ): Promise<SyncWriteDiagnostics> {
    if (writes.length === 0) return emptySyncWriteDiagnostics();
    const [stored, standings] = await Promise.all([
      this.deps.fieldGames.findResults(sportEventId),
      this.deps.fieldGames.findStandings(sportEventId),
    ]);
    const storedByKey = new Map(stored.map((result) => [roundKey(result.sportEventParticipantId, result.roundNumber), result]));

    const planned = writes.map((write) => {
      const before = storedByKey.get(roundKey(write.sportEventParticipantId, write.round.roundNumber));
      const side = sideWriteOf(write);
      return { write, side, before, disposition: before === undefined ? 'CREATED' as const : sameSide(before, side) ? 'UNCHANGED' as const : 'UPDATED' as const };
    });
    const changed = planned.filter((plan) => plan.disposition !== 'UNCHANGED');

    const asOf = (this.deps.now ?? (() => new Date()))();
    // The event's results as they stand after the write: every golfer's rounds, by field row.
    const merged = new Map<string, FieldSideWrite & { roundNumber: number }>(storedByKey);
    for (const { write, side } of changed) {
      merged.set(roundKey(write.sportEventParticipantId, write.round.roundNumber), { ...side, roundNumber: write.round.roundNumber });
    }
    const games = gameWritesOf(changed.map((plan) => plan.write), [...merged.values()], asOf);

    const standingWrites = standingWritesOf(writes, [...merged.values()], standings, asOf);
    const standingByEntry = new Map(standings.map((standing) => [standing.sportEventParticipantId, standing]));
    const changedStandings = standingWrites.filter((write) => {
      const before = standingByEntry.get(write.sportEventParticipantId);
      return before === undefined || !sameStanding(before, write);
    });

    if (games.length > 0 || changedStandings.length > 0) {
      // The event's boards are rebuilt from the write, so the rebuild job commits with it or not at all (#1466).
      const rebuild = await this.deps.domainEvents.collect({ type: DomainEventType.SPORT_EVENT_RESULTS_CHANGED, sportEventId });
      await this.deps.fieldGames.applyResults(sportEventId, { games, standings: changedStandings, jobs: rebuild.jobs });
      rebuild.queued();
    }

    const changedStandingIds = new Set(changedStandings.map((write) => write.sportEventParticipantId));
    const roundRows: SyncWriteDetailRow[] = planned.map((plan) => ({
      id: `golf-round:${plan.write.sportEventParticipantId}:${plan.write.round.roundNumber}`,
      entityType: 'SportEventRoundMatchGameSideResult',
      disposition: plan.disposition,
      ...(plan.write.participantExternalId ? { participantExternalId: plan.write.participantExternalId } : {}),
      ...(plan.before ? { before: comparableSide(plan.before) } : {}),
      after: comparableSide(plan.side),
    }));
    // The named golfers' standings: every one of them has one after the write.
    const named = new Set(writes.map((write) => write.sportEventParticipantId));
    const standingRows: SyncWriteDetailRow[] = standingWrites.filter((after) => named.has(after.sportEventParticipantId)).map((after) => {
      const entryId = after.sportEventParticipantId;
      const before = standingByEntry.get(entryId);
      return {
        id: `golf-standing:${entryId}`,
        entityType: 'SportEventParticipantStanding',
        disposition: before === undefined ? 'CREATED' : changedStandingIds.has(entryId) ? 'UPDATED' : 'UNCHANGED',
        internalId: before?.id,
        ...(before ? { before: comparableStanding(before) } : {}),
        after: comparableStanding(after),
      };
    });
    return mergeSyncWriteDiagnostics([summarizeSyncWriteRows(roundRows), summarizeSyncWriteRows(standingRows)]);
  }

  // ===========================================================================
  // Admin score-correction surface, test events only (#2074).
  // ===========================================================================

  /** Dry run — resolves every row against the event's field and reports the change it would make. Writes nothing. */
  async previewRoundScores(sportEventId: string, roundNumber: number, rows: GolfScoreRowInput[]): Promise<GolfScorePreviewRow[]> {
    return (await this.previewOnRound(sportEventId, roundNumber, rows)).preview;
  }

  /** The preview, with the round it is for: apply writes onto that round without reading it again. */
  private async previewOnRound(sportEventId: string, roundNumber: number, rows: GolfScoreRowInput[]): Promise<{ round: SportEventRound; preview: GolfScorePreviewRow[] }> {
    await this.requireGolfScoredEvent(sportEventId);
    const round = await this.requireRound(sportEventId, roundNumber);
    const [field, stored] = await Promise.all([
      this.deps.field.findBySportEvent(sportEventId),
      this.deps.fieldGames.findResults(sportEventId),
    ]);
    const participants = await this.deps.participants.findByIds(field.map((entry) => entry.participantId));
    const feedIds = await feedIdsOfCandidates(rows, participants, this.deps.mappings);
    const entryIdByParticipantId = new Map(field.map((entry) => [entry.participantId, entry.id]));
    const existingByEntry = new Map(stored.filter((result) => result.roundNumber === roundNumber).map((result) => [result.sportEventParticipantId, result]));

    const preview = await Promise.all(rows.map(async (row): Promise<GolfScorePreviewRow> => {
      const resolved = await resolveParticipantRow(row, matchAmong(participants, feedIds));
      const after: GolfRoundValues = { strokes: row.strokes, scoreToPar: row.scoreToPar, thru: row.thru ?? null, status: row.status };
      const sportEventParticipantId = resolved.participant ? entryIdByParticipantId.get(resolved.participant.id) ?? null : null;
      if (resolved.resolution !== 'MATCHED' || !sportEventParticipantId) {
        return { row, resolution: resolved.resolution, sportEventParticipantId: null, participantName: null, change: 'CREATE' as const, before: null, after };
      }
      const existing = existingByEntry.get(sportEventParticipantId);
      const before = existing ? roundValuesOf(existing) : null;
      // Apply stores nothing for a row with no strokes, as the sync path skips it.
      const change: GolfScoreChange = row.strokes === null
        ? 'SKIPPED'
        : !before ? 'CREATE' : golfRoundValuesEqual(before, after) ? 'UNCHANGED' : 'UPDATE';
      return { row, resolution: 'MATCHED' as const, sportEventParticipantId, participantName: resolved.participant?.name ?? null, change, before, after };
    }));
    return { round, preview };
  }

  /** Applies a previewed upload — all or none, 422 when any row is unresolved — with the standings, as the sync path does. */
  async applyRoundScores(sportEventId: string, roundNumber: number, rows: GolfScoreRowInput[]): Promise<void> {
    const { round, preview } = await this.previewOnRound(sportEventId, roundNumber, rows);
    const unresolved = preview.filter((row) => row.resolution !== 'MATCHED' || !row.sportEventParticipantId);
    if (unresolved.length > 0) {
      throw new StrokePlayResultError(
        `${unresolved.length} round score row(s) could not be resolved to a golfer.`,
        'ROUND_SCORE_ROWS_UNRESOLVED',
        422,
      );
    }
    for (const row of preview) requireThruWithinRound(round, row.row.thru ?? null);
    const writes = preview.flatMap((row): RoundWrite[] => (row.row.strokes === null || row.sportEventParticipantId === null ? [] : [{
      sportEventParticipantId: row.sportEventParticipantId,
      round,
      strokes: row.row.strokes,
      scoreToPar: row.row.scoreToPar,
      thru: row.row.thru ?? null,
      status: row.row.status,
      missedCut: row.row.missedCut ?? false,
      completedAt: row.row.completedAt ? new Date(row.row.completedAt) : null,
    }]));
    await this.writeRounds(sportEventId, writes);
  }

  /**
   * Single-cell correction of one golfer's round. Unpatched values keep what was recorded. A
   * correction that would create the round must carry strokes and to par, because the server
   * never fills either in (#116, #398).
   */
  async updateRoundScore(sportEventId: string, roundNumber: number, sportEventParticipantId: string, patch: GolfRoundScorePatch): Promise<void> {
    await this.requireGolfScoredEvent(sportEventId);
    const entry = await this.deps.field.findById(sportEventParticipantId);
    if (!entry || entry.sportEventId !== sportEventId) {
      throw new StrokePlayResultError(
        `Field row ${sportEventParticipantId} is not on sport event ${sportEventId}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    const round = await this.requireRound(sportEventId, roundNumber);
    const existing = (await this.deps.fieldGames.findResults(sportEventId))
      .find((result) => result.sportEventParticipantId === sportEventParticipantId && result.roundNumber === roundNumber);
    const before = existing ? roundValuesOf(existing) : null;
    const strokes = patch.strokes ?? before?.strokes ?? undefined;
    const scoreToPar = patch.scoreToPar ?? before?.scoreToPar;
    if (strokes === undefined || scoreToPar === undefined) {
      throw new StrokePlayResultError(
        `Golfer ${sportEventParticipantId} has no round ${roundNumber} on sport event ${sportEventId}; creating it needs both strokes and scoreToPar.`,
        'ROUND_VALUES_REQUIRED',
        422,
      );
    }
    const thru = patch.thru !== undefined ? patch.thru : before?.thru ?? null;
    requireThruWithinRound(round, patch.thru ?? null);
    await this.writeRounds(sportEventId, [{
      sportEventParticipantId,
      round,
      strokes,
      scoreToPar,
      thru,
      status: patch.status !== undefined ? patch.status : before?.status ?? null,
      missedCut: patch.missedCut ?? false,
      completedAt: patch.completedAt ? new Date(patch.completedAt) : null,
    }]);
  }

  /** The event's round of this number; an admin cannot score a round the event does not have (#375). */
  private async requireRound(sportEventId: string, roundNumber: number): Promise<SportEventRound> {
    const round = (await this.deps.rounds.findBySportEvent(sportEventId)).find((candidate) => candidate.roundNumber === roundNumber);
    if (round === undefined) {
      throw new StrokePlayResultError(
        `Sport event ${sportEventId} has no round ${roundNumber}.`,
        'ROUND_BEYOND_SCHEDULE',
        422,
      );
    }
    return round;
  }

  /**
   * The event an admin golf score is for, refused with 422 EVENT_SCORING_FAMILY_MISMATCH when
   * its sport's scoring family does not keep golf round scores: writing golf results onto it
   * would leave results its leaderboard never reads. Null when there is no such event; the
   * handler has already answered 404 for that.
   */
  private async requireGolfScoredEvent(sportEventId: string): Promise<SportEvent | null> {
    const event = await this.deps.events.findById(sportEventId);
    if (event && !this.deps.storesGolfRoundScores(event)) {
      this.deps.logger?.warn({ sportEventId, sport: event.sport }, 'Refused golf round scores for an event whose scoring family does not keep them');
      throw new StrokePlayResultError(
        `Sport event ${sportEventId} is a ${event.sport} event, whose scoring family does not keep golf round scores.`,
        'EVENT_SCORING_FAMILY_MISMATCH',
        422,
      );
    }
    return event;
  }
}

function roundKey(sportEventParticipantId: string, roundNumber: number): string {
  return JSON.stringify([sportEventParticipantId, roundNumber]);
}

/**
 * A golfer's round as its side result: a finished round (completed, or completed and then cut on)
 * is FINISHED with every hole of the round thru; a cut is the standing's, never the round's.
 */
function sideWriteOf(write: RoundWrite): FieldSideWrite {
  const { status } = write;
  const holes = write.round.slot.periods?.count ?? null;
  return {
    sportEventParticipantId: write.sportEventParticipantId,
    score: write.strokes,
    scoreToPar: write.scoreToPar,
    periodsCompleted: write.thru ?? (status === GameSideStatus.FINISHED ? holes : null),
    position: null,
    startPosition: null,
    status,
  };
}

/** A stored round as the admin preview shows it. */
function roundValuesOf(result: FieldSideResult): GolfRoundValues {
  return { strokes: result.score, scoreToPar: result.scoreToPar ?? 0, thru: result.periodsCompleted, status: result.status };
}

/** Each round the write changes: its Game is COMPLETED once every golfer in it has finished, at the latest finish sent. */
function gameWritesOf(changed: readonly RoundWrite[], merged: ReadonlyArray<FieldSideWrite & { roundNumber: number }>, asOf: Date): FieldGameWrite[] {
  const roundNumbers = [...new Set(changed.map((write) => write.round.roundNumber))];
  return roundNumbers.map((roundNumber) => {
    const inRound = changed.filter((write) => write.round.roundNumber === roundNumber);
    const finished = merged.filter((result) => result.roundNumber === roundNumber).every((result) => result.status !== null);
    const lastFinish = inRound.reduce<Date | null>((last, write) => (write.completedAt !== null && (last === null || write.completedAt > last) ? write.completedAt : last), null);
    return {
      roundNumber,
      status: finished ? MatchStatus.COMPLETED : MatchStatus.IN_PROGRESS,
      completedAt: finished ? lastFinish ?? asOf : null,
      sides: inRound.map(sideWriteOf),
    };
  });
}

/**
 * Every golfer's standing after the write. A named golfer's totals are the sums of their rounds,
 * and their status is their latest round's when the write names it (a missed cut ELIMINATED, a
 * withdrawal WITHDRAWN); the rest keep theirs. The whole field is then ranked (#246) on to-par,
 * lower is better, ties shown as "T3", a withdrawn or cut golfer unranked: the provider sends no
 * live rank, so it is computed here once per write and no reader re-derives it.
 */
function standingWritesOf(writes: readonly RoundWrite[], merged: ReadonlyArray<FieldSideWrite & { roundNumber: number }>, standings: readonly FieldStanding[], asOf: Date): FieldStandingWrite[] {
  const named = new Set(writes.map((write) => write.sportEventParticipantId));
  const byEntry = new Map<string, FieldStandingWrite>(standings.map((standing) => [standing.sportEventParticipantId, { ...standing, asOf: standing.asOf ?? asOf }]));
  for (const entryId of named) {
    const rounds = merged.filter((result) => result.sportEventParticipantId === entryId);
    const latestRound = latestParticipantRound(rounds, (result) => result);
    const latestWrite = writes.find((write) => write.sportEventParticipantId === entryId && write.round.roundNumber === latestRound?.roundNumber);
    const before = byEntry.get(entryId);
    byEntry.set(entryId, {
      sportEventParticipantId: entryId,
      position: before?.position ?? null,
      displayPosition: before?.displayPosition ?? null,
      status: latestWrite ? standingStatusOf(latestWrite) : before?.status ?? ParticipantStandingStatus.IN_PROGRESS,
      asOf,
      total: rounds.reduce((sum, result) => sum + (result.score ?? 0), 0),
      scoreToPar: rounds.reduce((sum, result) => sum + (result.scoreToPar ?? 0), 0),
    });
  }
  const { direction } = PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL;
  const rankedScore = (standing: FieldStandingWrite): number | null => (
    standing.status === ParticipantStandingStatus.WITHDRAWN || standing.status === ParticipantStandingStatus.ELIMINATED ? null : standing.scoreToPar
  );
  const sorted = [...byEntry.values()].sort((left, right) =>
    compareScores(direction, rankedScore(left), rankedScore(right))
    || left.sportEventParticipantId.localeCompare(right.sportEventParticipantId),
  );
  const ranks = rankSortedScores(sorted.map(rankedScore));
  return sorted.map((standing, index) => ({ ...standing, ...ranks[index] }));
}

/** A golfer's standing after the round the write names last: cut, withdrawn, done, or still playing. */
function standingStatusOf(write: Pick<RoundWrite, 'status' | 'missedCut'>): ParticipantStandingStatus {
  if (write.missedCut) {
    return ParticipantStandingStatus.ELIMINATED;
  }
  switch (write.status) {
    case null:
      return ParticipantStandingStatus.IN_PROGRESS;
    case GameSideStatus.FINISHED:
      return ParticipantStandingStatus.COMPLETE;
    case GameSideStatus.DID_NOT_FINISH:
    case GameSideStatus.DISQUALIFIED:
    case GameSideStatus.DID_NOT_START:
      return ParticipantStandingStatus.WITHDRAWN;
  }
}

/** The values a side result is compared and reported on. */
function comparableSide(side: FieldSideWrite): Record<string, unknown> {
  return { sportEventParticipantId: side.sportEventParticipantId, strokes: side.score, scoreToPar: side.scoreToPar, thru: side.periodsCompleted, status: side.status };
}

function sameSide(before: FieldSideWrite, after: FieldSideWrite): boolean {
  return JSON.stringify(comparableSide(before)) === JSON.stringify(comparableSide(after));
}

/**
 * The values a standing is compared and reported on. `asOf` is left out: it would advance on
 * every poll while what a member sees has not moved.
 */
function comparableStanding(standing: Omit<FieldStandingWrite, 'asOf'>): Record<string, unknown> {
  return {
    sportEventParticipantId: standing.sportEventParticipantId,
    eventScoreToPar: standing.scoreToPar,
    eventStrokes: standing.total,
    status: standing.status,
    position: standing.position,
    displayPosition: standing.displayPosition,
  };
}

function sameStanding(before: FieldStanding, after: FieldStandingWrite): boolean {
  return JSON.stringify(comparableStanding(before)) === JSON.stringify(comparableStanding(after));
}

/**
 * Refuses holes completed past the round's last (#375, #2047): a round's holes are its slot's
 * periods, eighteen for a golf tournament, and playoff holes are no part of a round. A round
 * whose slot keeps no score by period has no bound.
 */
function requireThruWithinRound(round: SportEventRound, thru: number | null): void {
  const holes = round.slot.periods?.count;
  if (thru !== null && holes !== undefined && thru > holes) {
    throw new StrokePlayResultError(`Round ${round.roundNumber} has ${holes} holes, so ${thru} holes cannot be completed.`, 'ROUND_THRU_BEYOND_HOLES', 422);
  }
}

function golfRoundValuesEqual(before: GolfRoundValues, after: GolfRoundValues): boolean {
  return before.strokes === after.strokes
    && before.scoreToPar === after.scoreToPar
    && before.thru === after.thru
    && before.status === after.status;
}
