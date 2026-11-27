/**
 * RaceResultService — the admin's finishing order for an event of the finish-position family
 * (#622). The results-entry counterpart of the golf score corrections: an admin enters every
 * runner's place and status, the server stores each value exactly as sent and derives none of
 * them (the score-correction pattern of #116), and refuses an order it cannot store whole.
 *
 * A race is one FIELD Match in the event's first round (#2008): each runner's result is its side
 * result in the race's Game, and the race is official once that Game is COMPLETED. Rows resolve
 * against the event's field with the shared participant-row resolver, by id or feed id, as the
 * golf scores do. Runners not named keep what is stored, so a
 * stewards' change is a one-row correction. The race is official as a whole: the official flag
 * sent is set on every result of the race.
 *
 * An apply also writes each runner's core standing, its place in the event (1 the winner, a dead
 * heat sharing a place), so every reader of the event's standings sees the finishing order.
 *
 * The feed's results (#2045, `persistSessionUpdatesForSportEvent`) take the same write: each
 * session of the league's session types is its Round (`sessionRounds`), its runners resolved to
 * the field through their provider mappings, and a race the feed reports as it is already stored
 * writes nothing.
 */
import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantRepository,
  FieldGameRepository,
  FieldGameWrite,
  FieldSideResult,
  FieldSideWrite,
  FieldStandingWrite,
  SportEventParticipantRepository,
  SportEventRepository,
  SportEventRoundRepository,
  SportLeagueSeasonRepository,
  ParticipantProviderMappingRepository,
} from '@poolmaster/shared/db';
import {
  RaceResultChange,
  RaceResultOrderError,
  RaceResultRowError,
  GameSideStatus,
  MatchStatus,
  type GameSideStatus as GameSideStatusValue,
  type SportEvent,
  SportEventParticipantStatus,
  requireProviderCodeOfSourceId,
  sessionRounds,
} from '@poolmaster/shared/domain';
import type { ApiErrorCode, RaceSessionUpdate } from '@poolmaster/shared/dto';
import {
  matchAmong,
  feedIdsOfCandidates,
  resolveParticipantRow,
  type ParticipantRowIdentifiers,
  type ParticipantRowResolution,
} from '../../sport-catalog/participant-row-resolver';
import { displayPlace, placesFormFinishingOrder, standingStatusForResult } from './race-order';
import type { ScoringFamilyEvent } from '../scoring-family-module';
import { DomainEventType, type DomainEvents } from '../../domain-events';
import { emptySyncWriteDiagnostics, summarizeSyncWriteRows, type SyncWriteDiagnostics, type SyncWriteDetailRow } from '../../ingestion/core/sync-write-diagnostics';

/** What a feed write of race results did, for the sync run (#2045). */
export interface RaceSessionPersistenceResult {
  updatesReturned: number;
  updatesPersisted: number;
  updatesSkipped: number;
  writeDiagnostics: SyncWriteDiagnostics;
  /** The feed's runner ids no participant is mapped to: skipped, and raised as findings by the publisher. */
  unmappedExternalIds: readonly string[];
}

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
  resultStatus: GameSideStatusValue;
  finishPosition: number | null;
  startPosition: number | null;
}

export interface RaceResultInput {
  isOfficial: boolean;
  rows: readonly RaceResultRowInput[];
}

export interface RaceResultValues {
  resultStatus: GameSideStatusValue;
  finishPosition: number | null;
  startPosition: number | null;
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
  /** The participants' provider mappings, read when an upload row names a feed id (#2040) and for the feed's runners (#2045). */
  mappings: Pick<ParticipantProviderMappingRepository, 'findByParticipantIds' | 'findByProviderExternalIds'>;
  /** The event's Rounds, which the feed's sessions are written to (#2045). */
  rounds: Pick<SportEventRoundRepository, 'findBySportEvent'>;
  /** The session types the event's league plays as Rounds: its session type provider mappings. */
  sessionTypes: Pick<SportLeagueSeasonRepository, 'findEventSessionTypes'>;
  /** The race's FIELD Game: its side results and status (#2008). */
  fieldGames: Pick<FieldGameRepository, 'findResults' | 'applyResults'>;
  /**
   * Whether an event of this sport keeps race results, by its sport's scoring family. Any other
   * event is refused rather than given rows its leaderboard never reads.
   */
  storesRaceResults: (event: ScoringFamilyEvent) => boolean;
  /** What follows each results, field or game change it writes (#1946): the app's one map. */
  domainEvents: Pick<DomainEvents, 'collect'>;
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
      this.deps.fieldGames.findResults(sportEventId).then(raceResultsOf),
    ]);
    const participants = await this.deps.participants.findByIds(field.map((entry) => entry.participantId));
    const entryIdByParticipantId = new Map(field.map((entry) => [entry.participantId, entry.id]));
    const storedByEntry = new Map(stored.map((result) => [result.sportEventParticipantId, result]));
    const feedIds = await feedIdsOfCandidates(input.rows, participants, this.deps.mappings);
    const resolved = await Promise.all(input.rows.map((row) => resolveParticipantRow(row, matchAmong(participants, feedIds))));

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
      field.some((entry) => entry.status === SportEventParticipantStatus.ACTIVE && !merged.has(entry.id))
      || [...merged.values()].some((values) => values.resultStatus === GameSideStatus.FINISHED && values.finishPosition === null)
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

    const sides: FieldSideWrite[] = preview.rows.map((row) => ({
      sportEventParticipantId: row.sportEventParticipantId as string,
      status: row.row.resultStatus,
      position: row.row.finishPosition,
      startPosition: row.row.startPosition,
      score: null,
      scoreToPar: null,
      periodsCompleted: null,
    }));
    const stored = raceResultsOf(await this.deps.fieldGames.findResults(sportEventId));
    const merged = new Map<string, Pick<RaceResultValues, 'resultStatus' | 'finishPosition'>>(
      stored.map((result) => [result.sportEventParticipantId, raceResultValues(result)]),
    );
    for (const row of preview.rows) merged.set(row.sportEventParticipantId as string, { resultStatus: row.row.resultStatus, finishPosition: row.row.finishPosition });
    const places = finishingPlaces(merged.values());
    const asOf = (this.deps.now ?? (() => new Date()))();
    const standings: FieldStandingWrite[] = [...merged].map(([sportEventParticipantId, result]) => ({
      sportEventParticipantId,
      position: result.finishPosition,
      displayPosition: result.finishPosition === null ? null : displayPlace(result.finishPosition, places),
      status: standingStatusForResult(result.resultStatus),
      asOf,
      total: null,
      scoreToPar: null,
    }));

    const rebuild = await this.deps.domainEvents.collect({ type: DomainEventType.SPORT_EVENT_RESULTS_CHANGED, sportEventId });
    // The race's Game moves its Match, and with it the slot's status (#2013).
    const statusChanged = await this.deps.domainEvents.collect({ type: DomainEventType.MATCH_STATUS_CHANGED, sportEventId });
    const status = input.isOfficial ? MatchStatus.COMPLETED : MatchStatus.IN_PROGRESS;
    await this.deps.fieldGames.applyResults(sportEventId, {
      games: [{ roundNumber: RACE_ROUND_NUMBER, status, completedAt: input.isOfficial ? asOf : null, sides }],
      standings,
      jobs: [...rebuild.jobs, ...statusChanged.jobs],
    });
    rebuild.queued();
    statusChanged.queued();
    this.deps.logger?.info({
      sportEventId,
      rows: sides.length,
      isOfficial: input.isOfficial,
    }, 'Applied a race result');
  }

  /**
   * The feed's results for the event (#2045): each session of `playedSessionTypes` is the Round
   * `sessionRounds` numbers it, and a session for a Round the event does not have is skipped. Each
   * runner is resolved through its provider mapping to the event's field: one with no mapping is
   * skipped and answered in `unmappedExternalIds`, one mapped but not on the field is skipped and
   * logged. A race is official when the feed marks its session final. A session whose results are
   * stored as the feed reports them writes nothing, so a sync that finds no change rebuilds no
   * leaderboard.
   */
  async persistSessionUpdatesForSportEvent(
    sportEventId: string,
    sessions: readonly RaceSessionUpdate[],
    providerId: string,
  ): Promise<RaceSessionPersistenceResult> {
    const playedSessionTypes = new Set(await this.deps.sessionTypes.findEventSessionTypes(sportEventId));
    const played = sessionRounds(sessions.map((session) => ({ ...session, startsAt: session.startsAt === null ? null : new Date(session.startsAt) })), playedSessionTypes);
    const updatesReturned = sessions.reduce((total, session) => total + session.runners.length, 0);
    if (played.length === 0) {
      return { updatesReturned, updatesPersisted: 0, updatesSkipped: updatesReturned, writeDiagnostics: emptySyncWriteDiagnostics(), unmappedExternalIds: [] };
    }
    const externalIds = [...new Set(played.flatMap(({ session }) => session.runners.map((runner) => runner.participantExternalId)))];
    const [eventRounds, mappings, field, stored] = await Promise.all([
      this.deps.rounds.findBySportEvent(sportEventId),
      this.deps.mappings.findByProviderExternalIds(requireProviderCodeOfSourceId(providerId), { sportEventId }, externalIds),
      this.deps.field.findBySportEvent(sportEventId),
      this.deps.fieldGames.findResults(sportEventId),
    ]);
    const roundNumbers = new Set(eventRounds.map((round) => round.roundNumber));
    const participantIdByExternalId = new Map(mappings.map((mapping) => [mapping.externalId, mapping.participantId]));
    const entryIdByParticipantId = new Map(field.map((entry) => [entry.participantId, entry.id]));
    const unmapped = new Set<string>();
    const offField = new Set<string>();
    let skipped = sessions.filter((session) => !played.some((round) => round.session.providerSessionId === session.providerSessionId))
      .reduce((total, session) => total + session.runners.length, 0);
    const rows: SyncWriteDetailRow[] = [];
    const games: FieldGameWrite[] = [];
    let standings: FieldStandingWrite[] = [];
    const asOf = (this.deps.now ?? (() => new Date()))();
    for (const { roundNumber, session } of played) {
      if (!roundNumbers.has(roundNumber)) {
        this.deps.logger?.warn({ action: 'liveScore.race.unscheduledRoundSkipped', data: { sportEventId, roundNumber, providerSessionId: session.providerSessionId } }, 'Skipping a race session for a round the event does not have');
        skipped += session.runners.length;
        continue;
      }
      const finishes: RaceFinish[] = [];
      for (const runner of session.runners) {
        const participantId = participantIdByExternalId.get(runner.participantExternalId);
        const sportEventParticipantId = participantId === undefined ? undefined : entryIdByParticipantId.get(participantId);
        if (participantId === undefined) unmapped.add(runner.participantExternalId);
        else if (sportEventParticipantId === undefined) offField.add(runner.participantExternalId);
        if (sportEventParticipantId === undefined) {
          skipped += 1;
          continue;
        }
        finishes.push({ sportEventParticipantId, status: runner.status, position: runner.status === GameSideStatus.FINISHED ? runner.position : null });
      }
      const sides: FieldSideWrite[] = finishes.map((finish) => ({ ...finish, startPosition: null, score: null, scoreToPar: null, periodsCompleted: null }));
      const before = new Map(stored.filter((result) => result.roundNumber === roundNumber).map((result) => [result.sportEventParticipantId, result]));
      const status = session.isOfficial ? MatchStatus.COMPLETED : MatchStatus.IN_PROGRESS;
      const unchanged = sides.every((side) => {
        const result = before.get(side.sportEventParticipantId);
        return result !== undefined && result.status === side.status && result.position === side.position && result.gameStatus === status;
      });
      for (const side of sides) {
        rows.push({
          id: `race-result:${side.sportEventParticipantId}:${String(roundNumber)}`,
          entityType: 'SportEventRoundMatchGameSideResult',
          disposition: unchanged ? 'UNCHANGED' : before.has(side.sportEventParticipantId) ? 'UPDATED' : 'CREATED',
          after: { status: side.status, position: side.position },
        });
      }
      if (unchanged) continue;
      games.push({ roundNumber, status, completedAt: session.isOfficial ? asOf : null, sides });
      // The event's standing is its last played session's finishing order: sessions run in start
      // order, so a weekend playing the sprint and the race stands on the race.
      const places = finishingPlaces(finishes.map((finish) => ({ resultStatus: finish.status, finishPosition: finish.position })));
      standings = finishes.map((side) => ({
        sportEventParticipantId: side.sportEventParticipantId,
        position: side.position,
        displayPosition: side.position === null ? null : displayPlace(side.position, places),
        status: standingStatusForResult(side.status),
        asOf,
        total: null,
        scoreToPar: null,
      }));
    }
    if (unmapped.size > 0 || offField.size > 0) {
      this.deps.logger?.warn(
        { action: 'liveScore.race.runnersSkipped', data: { providerId, sportEventId, unmapped: [...unmapped], notOnField: [...offField] } },
        'Skipping race results for runners with no mapping, or not on the event\'s field',
      );
    }
    if (games.length > 0) {
      // A Game's status moved with its results, so the slot's status is refreshed in the same write
      // and a race the feed calls final completes its slot.
      const rebuild = await this.deps.domainEvents.collect({ type: DomainEventType.SPORT_EVENT_RESULTS_CHANGED, sportEventId });
      const statusChanged = await this.deps.domainEvents.collect({ type: DomainEventType.MATCH_STATUS_CHANGED, sportEventId });
      await this.deps.fieldGames.applyResults(sportEventId, { games, standings, jobs: [...rebuild.jobs, ...statusChanged.jobs] });
      rebuild.queued();
      statusChanged.queued();
    }
    return {
      updatesReturned,
      updatesPersisted: games.reduce((total, game) => total + game.sides.length, 0),
      updatesSkipped: skipped,
      writeDiagnostics: summarizeSyncWriteRows(rows),
      unmappedExternalIds: [...unmapped],
    };
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
  const finished = row.resultStatus === GameSideStatus.FINISHED;
  if (!finished && row.finishPosition !== null) return RaceResultRowError.POSITION_WITHOUT_FINISH;
  if (finished && isOfficial && row.finishPosition === null) return RaceResultRowError.FINISH_WITHOUT_POSITION;
  return null;
}

/** The places of every finisher that has one. */
function finishingPlaces(results: Iterable<Pick<RaceResultValues, 'resultStatus' | 'finishPosition'>>): number[] {
  return [...results].flatMap((result) => (
    result.resultStatus === GameSideStatus.FINISHED && result.finishPosition !== null ? [result.finishPosition] : []
  ));
}

/** A runner's place in one feed session, on the event's field. */
interface RaceFinish {
  sportEventParticipantId: string;
  status: GameSideStatusValue;
  position: number | null;
}

/** A race is its event's round 1 (#2008): one FIELD Game with every runner a side. */
const RACE_ROUND_NUMBER = 1;

/** A runner's stored result: its side result in the race's Game, which is official once COMPLETED. */
interface RaceResult {
  sportEventParticipantId: string;
  status: GameSideStatusValue;
  position: number | null;
  startPosition: number | null;
  isOfficial: boolean;
}

/** The race's results among the event's FIELD side results; a side result with no status is no race result. */
function raceResultsOf(results: readonly FieldSideResult[]): RaceResult[] {
  return results.flatMap((result) => (result.roundNumber === RACE_ROUND_NUMBER && result.status !== null ? [{
    sportEventParticipantId: result.sportEventParticipantId,
    status: result.status,
    position: result.position,
    startPosition: result.startPosition,
    isOfficial: result.gameStatus === MatchStatus.COMPLETED,
  }] : []));
}

function raceResultValues(result: RaceResult): RaceResultValues {
  return {
    resultStatus: result.status,
    finishPosition: result.position,
    startPosition: result.startPosition,
    isOfficial: result.isOfficial,
  };
}

function raceResultValuesEqual(before: RaceResultValues, after: RaceResultValues): boolean {
  return before.resultStatus === after.resultStatus
    && before.finishPosition === after.finishPosition
    && before.startPosition === after.startPosition
    && before.isOfficial === after.isOfficial;
}
