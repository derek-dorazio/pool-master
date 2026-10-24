/**
 * RaceResultService — the admin's finishing order for an event of the finish-position family
 * (#622). The results-entry counterpart of the golf score corrections: an admin enters every
 * runner's place and status, the server stores each value exactly as sent and derives none of
 * them (the score-correction pattern of #116), and refuses an order it cannot store whole.
 *
 * Rows resolve against the event's field with the shared participant-row resolver, the same
 * precedence the field upload and golf scores use. Runners not named keep what is stored, so a
 * stewards' change is a one-row correction. The race is official as a whole: the official flag
 * sent is set on every result of the race.
 *
 * An apply also writes each runner's core standing, its place in the event (1 the winner, a dead
 * heat sharing a place), so every reader of the event's standings sees the finishing order.
 */
import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantRepository,
  RaceResultWrite,
  RaceStandingWrite,
  SportEventParticipantRaceResultRepository,
  SportEventParticipantRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  RaceResultChange,
  RaceResultOrderError,
  RaceResultRowError,
  RaceResultStatus,
  type RaceResultStatus as RaceResultStatusValue,
  type SportEvent,
  type SportEventParticipantRaceResult,
} from '@poolmaster/shared/domain';
import type { ApiErrorCode } from '@poolmaster/shared/dto';
import {
  matchAmong,
  resolveParticipantRow,
  type ParticipantRowIdentifiers,
  type ParticipantRowResolution,
} from '../../sport-catalog/participant-row-resolver';
import { displayPlace, placesFormFinishingOrder, standingStatusForResult } from './race-order';
import type { ScoringFamilyEvent } from '../scoring-family-module';

export class RaceResultError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'RaceResultError';
  }
}

/** One runner's result as sent: who it names, and every value. */
export interface RaceResultRowInput extends ParticipantRowIdentifiers {
  resultStatus: RaceResultStatusValue;
  finishPosition: number | null;
  startPosition: number | null;
  riderName: string | null;
}

export interface RaceResultInput {
  isOfficial: boolean;
  rows: readonly RaceResultRowInput[];
}

export interface RaceResultValues {
  resultStatus: RaceResultStatusValue;
  finishPosition: number | null;
  startPosition: number | null;
  riderName: string | null;
  isOfficial: boolean;
}

export interface RaceResultPreviewRow {
  row: RaceResultRowInput;
  resolution: ParticipantRowResolution;
  sportEventParticipantId: string | null;
  participantName: string | null;
  rowError: RaceResultRowError | null;
  /** Null when the row cannot be applied. */
  change: RaceResultChange | null;
  before: RaceResultValues | null;
  after: RaceResultValues;
}

export interface RaceResultPreview {
  rows: RaceResultPreviewRow[];
  orderErrors: RaceResultOrderError[];
}

export interface RaceResultServiceDeps {
  events: Pick<SportEventRepository, 'findById'>;
  field: Pick<SportEventParticipantRepository, 'findBySportEvent'>;
  participants: Pick<ParticipantRepository, 'findByIds'>;
  raceResults: SportEventParticipantRaceResultRepository;
  /**
   * Whether an event of this sport keeps race results, by its sport's scoring family. Any other
   * event is refused rather than given rows its leaderboard never reads.
   */
  storesRaceResults: (event: ScoringFamilyEvent) => boolean;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

export class RaceResultService {
  constructor(private readonly deps: RaceResultServiceDeps) {}

  /** Dry run: resolves every row against the field and reports what applying would do. Writes nothing. */
  async previewResults(sportEventId: string, input: RaceResultInput): Promise<RaceResultPreview> {
    await this.requireRaceScoredEvent(sportEventId);
    const [field, stored] = await Promise.all([
      this.deps.field.findBySportEvent(sportEventId),
      this.deps.raceResults.findBySportEvent(sportEventId),
    ]);
    const participants = await this.deps.participants.findByIds(field.map((entry) => entry.participantId));
    const entryIdByParticipantId = new Map(field.map((entry) => [entry.participantId, entry.id]));
    const storedByEntry = new Map(stored.map((result) => [result.sportEventParticipantId, result]));
    const resolved = await Promise.all(input.rows.map((row) => resolveParticipantRow(row, matchAmong(participants))));

    const rowCountByEntry = new Map<string, number>();
    for (const result of resolved) {
      const entryId = result.participant ? entryIdByParticipantId.get(result.participant.id) : undefined;
      if (entryId) rowCountByEntry.set(entryId, (rowCountByEntry.get(entryId) ?? 0) + 1);
    }

    const rows = input.rows.map((row, index): RaceResultPreviewRow => {
      const { resolution, participant } = resolved[index];
      const after: RaceResultValues = {
        resultStatus: row.resultStatus,
        finishPosition: row.finishPosition,
        startPosition: row.startPosition,
        riderName: row.riderName,
        isOfficial: input.isOfficial,
      };
      const sportEventParticipantId = participant ? entryIdByParticipantId.get(participant.id) ?? null : null;
      if (resolution !== 'MATCHED' || !participant || !sportEventParticipantId) {
        return {
          row,
          resolution: resolution === 'MATCHED' ? 'UNRESOLVED' : resolution,
          sportEventParticipantId: null,
          participantName: null,
          rowError: null,
          change: null,
          before: null,
          after,
        };
      }
      const existing = storedByEntry.get(sportEventParticipantId);
      const before = existing ? raceResultValues(existing) : null;
      const rowError = raceResultRowError(row, input.isOfficial, rowCountByEntry.get(sportEventParticipantId) ?? 0);
      return {
        row,
        resolution,
        sportEventParticipantId,
        participantName: participant.name,
        rowError,
        change: rowError ? null : !before ? RaceResultChange.CREATE : raceResultValuesEqual(before, after) ? RaceResultChange.UNCHANGED : RaceResultChange.UPDATE,
        before,
        after,
      };
    });

    // The race as it would stand: what is stored for runners not named, and the applicable rows.
    const applicable = new Map(rows.flatMap((row) => (
      row.change !== null && row.sportEventParticipantId !== null ? [[row.sportEventParticipantId, row.after] as const] : []
    )));
    const merged = new Map<string, RaceResultValues>(stored.map((result) => [result.sportEventParticipantId, raceResultValues(result)]));
    for (const [entryId, values] of applicable) merged.set(entryId, values);

    const orderErrors: RaceResultOrderError[] = [];
    if (!placesFormFinishingOrder(finishingPlaces(merged.values()))) {
      orderErrors.push(RaceResultOrderError.POSITIONS_INVALID);
    }
    // An official result leaves no active runner without one, and no finisher without a place.
    if (input.isOfficial && (
      field.some((entry) => entry.isActive && !merged.has(entry.id))
      || [...merged.values()].some((values) => values.resultStatus === RaceResultStatus.FINISHED && values.finishPosition === null)
    )) {
      orderErrors.push(RaceResultOrderError.FIELD_INCOMPLETE);
    }
    return { rows, orderErrors };
  }

  /**
   * Applies a previewed order, all or none. 422 RACE_RESULT_ROWS_INVALID when a row does not
   * resolve to one runner or carries a row error; 422 RACE_RESULT_POSITIONS_INVALID when the places
   * do not form a finishing order; 422 RACE_RESULT_FIELD_INCOMPLETE when an official result leaves
   * an active runner, or a finisher's place, unentered.
   */
  async applyResults(sportEventId: string, input: RaceResultInput): Promise<void> {
    const preview = await this.previewResults(sportEventId, input);
    const invalid = preview.rows.filter((row) => row.change === null || row.sportEventParticipantId === null);
    if (invalid.length > 0) {
      this.deps.logger?.warn({ sportEventId, invalidRows: invalid.length }, 'Refused a race result with rows that do not resolve or carry a row error');
      throw new RaceResultError(
        `${invalid.length} race result row(s) do not resolve to one runner on the field, or carry a row error.`,
        'RACE_RESULT_ROWS_INVALID',
        422,
      );
    }
    if (preview.orderErrors.includes(RaceResultOrderError.POSITIONS_INVALID)) {
      this.deps.logger?.warn({ sportEventId }, 'Refused a race result whose places do not form a finishing order');
      throw new RaceResultError(
        'The finishing places do not form a finishing order: they run 1, 2, 3 ..., and only a dead heat repeats a place, skipping the next (1, 2, 2, 4).',
        'RACE_RESULT_POSITIONS_INVALID',
        422,
      );
    }
    if (preview.orderErrors.includes(RaceResultOrderError.FIELD_INCOMPLETE)) {
      this.deps.logger?.warn({ sportEventId }, 'Refused an official race result that leaves runners without a result');
      throw new RaceResultError(
        'An official result needs a result for every active runner on the field, and a place for every finisher.',
        'RACE_RESULT_FIELD_INCOMPLETE',
        422,
      );
    }

    const results: RaceResultWrite[] = preview.rows.map((row) => ({
      sportEventParticipantId: row.sportEventParticipantId as string,
      resultStatus: row.row.resultStatus,
      finishPosition: row.row.finishPosition,
      startPosition: row.row.startPosition,
      riderName: row.row.riderName,
    }));
    const stored = await this.deps.raceResults.findBySportEvent(sportEventId);
    const merged = new Map<string, Pick<RaceResultWrite, 'resultStatus' | 'finishPosition'>>(
      stored.map((result) => [result.sportEventParticipantId, result]),
    );
    for (const result of results) merged.set(result.sportEventParticipantId, result);
    const places = finishingPlaces(merged.values());
    const asOf = (this.deps.now ?? (() => new Date()))();
    const standings: RaceStandingWrite[] = [...merged].map(([sportEventParticipantId, result]) => ({
      sportEventParticipantId,
      position: result.finishPosition,
      displayPosition: result.finishPosition === null ? null : displayPlace(result.finishPosition, places),
      status: standingStatusForResult(result.resultStatus),
      currentRound: null,
      asOf,
    }));

    await this.deps.raceResults.applyResults(sportEventId, { results, isOfficial: input.isOfficial, standings });
    this.deps.logger?.info({
      sportEventId,
      rows: results.length,
      isOfficial: input.isOfficial,
    }, 'Applied a race result');
  }

  /**
   * The event a finishing order is for, refused with 422 EVENT_SCORING_FAMILY_MISMATCH when its
   * sport's scoring family does not keep race results. Null when there is no such event; the
   * handler has already answered 404 for that.
   */
  private async requireRaceScoredEvent(sportEventId: string): Promise<SportEvent | null> {
    const event = await this.deps.events.findById(sportEventId);
    if (event && !this.deps.storesRaceResults(event)) {
      this.deps.logger?.warn({ sportEventId, sport: event.sport }, 'Refused a race result for an event whose scoring family does not keep them');
      throw new RaceResultError(
        `Sport event ${sportEventId} is a ${event.sport} event, whose scoring family does not keep race results.`,
        'EVENT_SCORING_FAMILY_MISMATCH',
        422,
      );
    }
    return event;
  }
}

function raceResultRowError(row: RaceResultRowInput, isOfficial: boolean, rowsNamingRunner: number): RaceResultRowError | null {
  if (rowsNamingRunner > 1) return RaceResultRowError.DUPLICATE_PARTICIPANT;
  const finished = row.resultStatus === RaceResultStatus.FINISHED;
  if (!finished && row.finishPosition !== null) return RaceResultRowError.POSITION_WITHOUT_FINISH;
  if (finished && isOfficial && row.finishPosition === null) return RaceResultRowError.FINISH_WITHOUT_POSITION;
  return null;
}

/** The places of every finisher that has one. */
function finishingPlaces(results: Iterable<Pick<RaceResultValues, 'resultStatus' | 'finishPosition'>>): number[] {
  return [...results].flatMap((result) => (
    result.resultStatus === RaceResultStatus.FINISHED && result.finishPosition !== null ? [result.finishPosition] : []
  ));
}

function raceResultValues(result: SportEventParticipantRaceResult): RaceResultValues {
  return {
    resultStatus: result.resultStatus,
    finishPosition: result.finishPosition,
    startPosition: result.startPosition,
    riderName: result.riderName,
    isOfficial: result.isOfficial,
  };
}

function raceResultValuesEqual(before: RaceResultValues, after: RaceResultValues): boolean {
  return before.resultStatus === after.resultStatus
    && before.finishPosition === after.finishPosition
    && before.startPosition === after.startPosition
    && before.riderName === after.riderName
    && before.isOfficial === after.isOfficial;
}
