/**
 * SportEventParticipantService — an event's field: who is competing, each field row's
 * event-scoped state, and the read every screen of an event's participants uses
 * (plans/124 §4.7, #236).
 *
 * `listEventParticipants` is that one read. It returns each field row with its canonical
 * participant, valuation, standing and rounds — the core row plus the sport's extension
 * at each level — so the field grid, the scores screen and the event browser all read
 * the same object. Before #236 those were three projections of these rows.
 *
 * Seeding from a sport league copies its active affiliations onto the field once; it
 * does not constrain the field afterwards. `addParticipants` is the deliberate path for
 * anyone else (a LIV golfer at a PGA event): there was never a constraint to bypass.
 *
 * The field upload (#128) adjusts rankings, odds, seeds and withdrawals of participants
 * already on the field; it never adds one. Live scores reach a participant only through a
 * provider mapping, so the field comes from the provider first and the upload resolves
 * rows against the field alone, with the shared participant-row resolver. Its apply goes
 * through `updateParticipants`, the grid save, so a field edit has one write path.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantLeagueAffiliationRepository,
  ParticipantRepository,
  SportEventParticipantGolfRoundRepository,
  SportEventParticipantGolfStandingRepository,
  SportEventParticipantPatch,
  SportEventParticipantRepository,
  SportEventParticipantRoundRepository,
  SportEventParticipantStandingRepository,
  SportEventParticipantValuationRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  ParticipantStatus,
  Sport,
  type ParticipantInactiveReason,
  type Participant,
  type SportEvent,
  type SportEventParticipant,
  type SportEventParticipantGolfRound,
  type SportEventParticipantGolfStanding,
  type SportEventParticipantRound,
  type SportEventParticipantStanding,
  type SportEventParticipantValuation,
} from '@poolmaster/shared/domain';
import { deriveSeedNumbersAndOdds } from '../golf/golf-seeding-algorithm';
import {
  matchAmong,
  resolveParticipantRow,
  type ParticipantRowIdentifiers,
  type ParticipantRowResolution,
} from '../sport-catalog/participant-row-resolver';
import { SportEventError } from './errors';
import { assertTiersAndPricesEditable } from './sport-event-tier-service';

/** A round row with its sport extension, when the sport has one and it has been scored. */
export interface ParticipantRoundView {
  round: SportEventParticipantRound;
  golf: SportEventParticipantGolfRound | null;
}

/** A standing row with its sport extension. */
export interface ParticipantStandingView {
  standing: SportEventParticipantStanding;
  golf: SportEventParticipantGolfStanding | null;
}

/** One field row, as every reader of an event's participants sees it. */
export interface SportEventParticipantView {
  entry: SportEventParticipant;
  participant: Participant;
  valuation: SportEventParticipantValuation | null;
  standing: ParticipantStandingView | null;
  rounds: ParticipantRoundView[];
  /** Whether the participant is affiliated with the event's sport league — false flags an invite from elsewhere. */
  affiliatedWithSportLeague: boolean;
}

export interface SeedFieldResult {
  added: number;
  skipped: number;
  total: number;
  seedNumbersDerived: number;
  oddsDerived: number;
}

export interface AddFieldResult {
  added: number;
  skipped: number;
  total: number;
}

export interface FieldEntryUpdate extends SportEventParticipantPatch {
  sportEventParticipantId: string;
  price?: number | null;
}

/** One uploaded row: who it names, and the values to set. Omitted leaves a value alone; null clears it. */
export interface FieldUploadRowInput extends ParticipantRowIdentifiers, SportEventParticipantPatch {}

/** The values an upload can change on a field row, each as stored (null when unset). */
export interface FieldUploadValues {
  isActive: boolean;
  inactiveReason: ParticipantInactiveReason | null;
  ranking: number | null;
  oddsToWin: number | null;
  seedNumber: number | null;
}

export type FieldUploadChange = 'UPDATE' | 'UNCHANGED';

/** A row that resolved but still cannot be applied. */
export type FieldUploadRowError = 'DUPLICATE_PARTICIPANT';

export interface FieldUploadPreviewRow {
  row: FieldUploadRowInput;
  resolution: ParticipantRowResolution;
  /** Set only when MATCHED. */
  participantId: string | null;
  participantName: string | null;
  sportEventParticipantId: string | null;
  rowError: FieldUploadRowError | null;
  /** Null when the row cannot be applied: not MATCHED, or a row error. */
  change: FieldUploadChange | null;
  /** Set whenever the row resolved to a field row. */
  before: FieldUploadValues | null;
  /** Null when the row cannot be applied. */
  after: FieldUploadValues | null;
  /** Why the row cannot be applied; null when it can. */
  message: string | null;
}

const FIELD_UPLOAD_VALUE_KEYS = ['isActive', 'inactiveReason', 'ranking', 'oddsToWin', 'seedNumber'] as const;

function fieldUploadValues(entry: SportEventParticipant): FieldUploadValues {
  return {
    isActive: entry.isActive,
    inactiveReason: entry.inactiveReason ?? null,
    ranking: entry.ranking ?? null,
    oddsToWin: entry.oddsToWin ?? null,
    seedNumber: entry.seedNumber ?? null,
  };
}

/** The patch a row carries: only the values it names, each exactly as sent. */
function fieldUploadPatch(row: FieldUploadRowInput): SportEventParticipantPatch {
  const patch: SportEventParticipantPatch = {};
  if (row.isActive !== undefined) patch.isActive = row.isActive;
  if (row.inactiveReason !== undefined) patch.inactiveReason = row.inactiveReason;
  if (row.ranking !== undefined) patch.ranking = row.ranking;
  if (row.oddsToWin !== undefined) patch.oddsToWin = row.oddsToWin;
  if (row.seedNumber !== undefined) patch.seedNumber = row.seedNumber;
  return patch;
}

function describeIdentifier(row: ParticipantRowIdentifiers): string | null {
  if (row.participantId) return `participantId "${row.participantId}"`;
  if (row.externalId) return `externalId "${row.externalId}"`;
  if (row.playerName) return `playerName "${row.playerName}"`;
  return null;
}

function unresolvedMessage(row: ParticipantRowIdentifiers, resolution: ParticipantRowResolution): string {
  const identifier = describeIdentifier(row);
  if (!identifier) {
    return 'The row names no participant: give a participantId, externalId or playerName.';
  }
  if (resolution === 'AMBIGUOUS') {
    return `Several participants on this event's field match ${identifier}; name the participant by participantId or externalId.`;
  }
  return `No participant on this event's field matches ${identifier}. The upload only changes participants already on the field — refresh the field from the provider first.`;
}

export interface SportEventParticipantServiceDeps {
  sportEvents: SportEventRepository;
  field: SportEventParticipantRepository;
  participants: ParticipantRepository;
  affiliations: ParticipantLeagueAffiliationRepository;
  valuations: SportEventParticipantValuationRepository;
  standings: SportEventParticipantStandingRepository;
  participantRounds: SportEventParticipantRoundRepository;
  golfStandings: SportEventParticipantGolfStandingRepository;
  golfRounds: SportEventParticipantGolfRoundRepository;
  random?: () => number;
  logger?: FastifyBaseLogger;
}

export class SportEventParticipantService {
  constructor(private readonly deps: SportEventParticipantServiceDeps) {}

  /** The field in seed order, unseeded last. 404 EVENT_NOT_FOUND for an unknown event. */
  async listEventParticipants(sportEventId: string): Promise<SportEventParticipantView[]> {
    const event = await this.requireEvent(sportEventId);
    const field = await this.deps.field.findBySportEvent(sportEventId);
    const isGolf = event.sport === Sport.GOLF;
    const [participants, valuations, standings, rounds, golfStandings, golfRounds, affiliated] = await Promise.all([
      this.deps.participants.findByIds(field.map((entry) => entry.participantId)),
      this.deps.valuations.findBySportEvent(sportEventId),
      this.deps.standings.findBySportEvent(sportEventId),
      this.deps.participantRounds.findBySportEvent(sportEventId),
      isGolf ? this.deps.golfStandings.findBySportEvent(sportEventId) : Promise.resolve([]),
      isGolf ? this.deps.golfRounds.findBySportEvent(sportEventId) : Promise.resolve([]),
      this.affiliatedParticipantIds(event),
    ]);

    const participantById = new Map(participants.map((participant) => [participant.id, participant]));
    const valuationByEntry = new Map(valuations.map((valuation) => [valuation.sportEventParticipantId, valuation]));
    const standingByEntry = new Map(standings.map((standing) => [standing.sportEventParticipantId, standing]));
    const golfByStanding = new Map(golfStandings.map((result) => [result.standing.id, result.golf]));
    const golfByRound = new Map(golfRounds.map((result) => [result.participantRound.id, result.golf]));
    const roundsByEntry = new Map<string, ParticipantRoundView[]>();
    for (const round of rounds) {
      const list = roundsByEntry.get(round.sportEventParticipantId) ?? [];
      list.push({ round, golf: golfByRound.get(round.id) ?? null });
      roundsByEntry.set(round.sportEventParticipantId, list);
    }

    return field.map((entry) => {
      const standing = standingByEntry.get(entry.id);
      return {
        entry,
        participant: participantById.get(entry.participantId) as Participant,
        valuation: valuationByEntry.get(entry.id) ?? null,
        standing: standing ? { standing, golf: golfByStanding.get(standing.id) ?? null } : null,
        rounds: roundsByEntry.get(entry.id) ?? [],
        affiliatedWithSportLeague: affiliated.has(entry.participantId),
      };
    });
  }

  /**
   * Copies the event's sport league's active affiliations onto the field, deriving seed
   * numbers and odds for the ones added. Idempotent: participants already on the field
   * are skipped and keep what they have.
   */
  async seedFromSportLeague(sportEventId: string): Promise<SeedFieldResult> {
    const event = await this.requireEvent(sportEventId);
    if (event.sport !== Sport.GOLF) {
      throw new SportEventError(
        `Seeding a field from a sport league is implemented for golf only, not ${event.sport}.`,
        'SPORT_NOT_SUPPORTED',
        422,
      );
    }
    const { sportLeagueId } = event;
    const affiliations = (await this.deps.affiliations.findBySportLeague(sportLeagueId))
      .filter((affiliation) => affiliation.participant.status === ParticipantStatus.ACTIVE);
    const onField = new Set((await this.deps.field.findBySportEvent(sportEventId)).map((entry) => entry.participantId));
    const toAdd = affiliations.filter((affiliation) => !onField.has(affiliation.participantId));
    const seeded = deriveSeedNumbersAndOdds(
      toAdd.map((affiliation) => ({ participantId: affiliation.participantId, ranking: affiliation.ranking })),
      this.deps.random,
    );
    if (seeded.length > 0) {
      await this.deps.field.createMany(sportEventId, seeded.map((entry) => ({
        participantId: entry.participantId,
        ranking: entry.ranking,
        seedNumber: entry.seedNumber,
        oddsToWin: entry.oddsToWin,
      })));
    }

    this.deps.logger?.info(
      { sportEventId, sportLeagueId, added: seeded.length, skipped: affiliations.length - seeded.length },
      'Seeded field from sport league',
    );
    return {
      added: seeded.length,
      skipped: affiliations.length - seeded.length,
      total: affiliations.length,
      seedNumbersDerived: seeded.length,
      oddsDerived: seeded.length,
    };
  }

  /** Adds any participants to the field; idempotent for ones already on it. */
  async addParticipants(sportEventId: string, participantIds: readonly string[]): Promise<AddFieldResult> {
    await this.requireEvent(sportEventId);
    const onField = new Set((await this.deps.field.findBySportEvent(sportEventId)).map((entry) => entry.participantId));
    const toAdd = [...new Set(participantIds)].filter((participantId) => !onField.has(participantId));
    if (toAdd.length > 0) {
      await this.deps.field.createMany(sportEventId, toAdd.map((participantId) => ({ participantId })));
    }
    this.deps.logger?.info(
      { sportEventId, added: toAdd.length, skipped: participantIds.length - toAdd.length },
      'Added participants to the field',
    );
    return { added: toAdd.length, skipped: participantIds.length - toAdd.length, total: participantIds.length };
  }

  /**
   * One save of the field grid: every patched row and its manual price, all or none. Rank,
   * odds, seed and withdrawals stay editable after release; a price does not (409
   * SPORT_EVENT_TIERS_LOCKED, #431).
   */
  async updateParticipants(sportEventId: string, updates: readonly FieldEntryUpdate[]): Promise<SportEventParticipantView[]> {
    const event = await this.requireEvent(sportEventId);
    if (updates.some((update) => update.price !== undefined)) {
      try {
        assertTiersAndPricesEditable(event);
      } catch (error) {
        this.deps.logger?.warn({ sportEventId, status: event.status }, 'Refused a price change on a released sport event');
        throw error;
      }
    }
    const onField = new Set((await this.deps.field.findBySportEvent(sportEventId)).map((entry) => entry.id));
    const notOnField = updates.filter((update) => !onField.has(update.sportEventParticipantId));
    if (notOnField.length > 0) {
      throw new SportEventError(
        `Not on sport event ${sportEventId}'s field: ${notOnField.map((update) => update.sportEventParticipantId).join(', ')}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    await this.deps.field.updateMany(updates.map(({ sportEventParticipantId, price, ...patch }) => ({
      id: sportEventParticipantId,
      updates: patch,
      price,
    })));
    return this.listEventParticipants(sportEventId);
  }

  /**
   * Dry run of a field upload (#128): resolves each row against the event's field and
   * reports what applying it would change. Writes nothing. A participant not on the field
   * is UNRESOLVED — the upload never adds one. A participant named by two or more rows
   * is a row error on each of them. 404 EVENT_NOT_FOUND for an unknown event.
   */
  async previewUpload(sportEventId: string, rows: readonly FieldUploadRowInput[]): Promise<FieldUploadPreviewRow[]> {
    await this.requireEvent(sportEventId);
    const field = await this.deps.field.findBySportEvent(sportEventId);
    const participants = await this.deps.participants.findByIds(field.map((entry) => entry.participantId));
    const entryByParticipantId = new Map(field.map((entry) => [entry.participantId, entry]));
    const resolved = await Promise.all(rows.map((row) => resolveParticipantRow(row, matchAmong(participants))));

    const rowNumbersByParticipant = new Map<string, number[]>();
    resolved.forEach((result, index) => {
      if (!result.participant) return;
      const list = rowNumbersByParticipant.get(result.participant.id) ?? [];
      list.push(index + 1);
      rowNumbersByParticipant.set(result.participant.id, list);
    });

    return rows.map((row, index) => {
      const { resolution, participant } = resolved[index];
      const entry = participant ? entryByParticipantId.get(participant.id) : undefined;
      if (resolution !== 'MATCHED' || !participant || !entry) {
        return {
          row,
          resolution: resolution === 'MATCHED' ? 'UNRESOLVED' : resolution,
          participantId: null,
          participantName: null,
          sportEventParticipantId: null,
          rowError: null,
          change: null,
          before: null,
          after: null,
          message: unresolvedMessage(row, resolution),
        };
      }
      const before = fieldUploadValues(entry);
      const matched = {
        row,
        resolution,
        participantId: participant.id,
        participantName: participant.name,
        sportEventParticipantId: entry.id,
        before,
      };
      const rowNumbers = rowNumbersByParticipant.get(participant.id) ?? [];
      if (rowNumbers.length > 1) {
        return {
          ...matched,
          rowError: 'DUPLICATE_PARTICIPANT' as const,
          change: null,
          after: null,
          message: `${participant.name} is named by rows ${rowNumbers.join(', ')}; keep one row per participant.`,
        };
      }
      const after: FieldUploadValues = { ...before, ...fieldUploadPatch(row) };
      const changed = FIELD_UPLOAD_VALUE_KEYS.some((key) => before[key] !== after[key]);
      return { ...matched, rowError: null, change: changed ? 'UPDATE' as const : 'UNCHANGED' as const, after, message: null };
    });
  }

  /**
   * Applies a field upload (#128): re-runs the preview and, when every row is MATCHED with
   * no row error, patches the rows that change through the grid save — one transaction,
   * all or none. Otherwise 422 EVENT_PARTICIPANT_UPLOAD_ROWS_UNRESOLVED and nothing is
   * written. Returns the field.
   */
  async applyUpload(sportEventId: string, rows: readonly FieldUploadRowInput[]): Promise<SportEventParticipantView[]> {
    const preview = await this.previewUpload(sportEventId, rows);
    const blocked = preview.filter((row) => row.resolution !== 'MATCHED' || row.rowError !== null);
    if (blocked.length > 0) {
      throw new SportEventError(
        `${blocked.length} field upload row(s) cannot be applied: each row must name exactly one participant on the field, once.`,
        'EVENT_PARTICIPANT_UPLOAD_ROWS_UNRESOLVED',
        422,
      );
    }
    const updates: FieldEntryUpdate[] = preview
      .filter((row) => row.change === 'UPDATE')
      .map((row) => ({ sportEventParticipantId: row.sportEventParticipantId as string, ...fieldUploadPatch(row.row) }));
    this.deps.logger?.info(
      { sportEventId, rows: rows.length, updated: updates.length },
      'Applied field upload',
    );
    if (updates.length === 0) {
      return this.listEventParticipants(sportEventId);
    }
    return this.updateParticipants(sportEventId, updates);
  }

  /** Removes a field row. Refused (409) once any contest entry has picked it — withdraw instead. */
  async removeParticipant(sportEventId: string, sportEventParticipantId: string): Promise<void> {
    const entry = await this.deps.field.findById(sportEventParticipantId);
    if (!entry || entry.sportEventId !== sportEventId) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} is not on sport event ${sportEventId}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    const picks = await this.deps.field.countPicks(sportEventParticipantId);
    if (picks > 0) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} has ${picks} contest entry pick(s) and cannot be removed — withdraw it instead.`,
        'EVENT_PARTICIPANT_HAS_PICKS',
        409,
      );
    }
    await this.deps.field.delete(sportEventParticipantId);
  }

  private async requireEvent(sportEventId: string): Promise<SportEvent> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event) {
      throw new SportEventError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    return event;
  }

  private async affiliatedParticipantIds(event: SportEvent): Promise<Set<string>> {
    return new Set((await this.deps.affiliations.findBySportLeague(event.sportLeagueId)).map((affiliation) => affiliation.participantId));
  }
}
