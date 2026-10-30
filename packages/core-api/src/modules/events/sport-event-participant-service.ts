/**
 * SportEventParticipantService — an event's field: who is competing, each field row's
 * event-scoped state, and the read every screen of an event's participants uses
 * (plans/124 §4.7, #236).
 *
 * `listEventParticipants` is that one read. It returns each field row with its canonical
 * participant, valuation, standing and rounds — the core row plus the sport's extension
 * at each level — so the field grid, the scores screen and the event browser all read
 * the same object. Before #236 those were three projections of these rows. Since #1163 it
 * is one repository call, and what viewers poll, `listCachedEventParticipants`, is shared
 * by every contest on the event for up to 30 seconds.
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
  SportEventParticipantPatch,
  SportEventMatchRepository,
  SportEventParticipantRepository,
  SportEventParticipantView,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  getSportDefinition,
  ParticipantStatus,
  eventPlaysMatches,
  SportEventStatus,
  type ParticipantInactiveReason,
  type SportEvent,
  type SportEventParticipant,
} from '@poolmaster/shared/domain';
import { BatchedRead } from '../../core/batched-read';
import { ReadCache } from '../../core/read-cache';
import { deriveSeedNumbersAndOdds } from '../golf/golf-seeding-algorithm';
import {
  matchAmong,
  resolveParticipantRow,
  type ParticipantRowIdentifiers,
  type ParticipantRowResolution,
} from '../sport-catalog/participant-row-resolver';
import { SportEventError } from './errors';
import type { EventFieldCache } from './event-field-cache';
import { assertTiersAndPricesEditable } from './sport-event-tier-service';

// The field row a reader sees lives with the port that reads it (#1163).
export type { ParticipantRoundView, ParticipantStandingView, SportEventParticipantView } from '@poolmaster/shared/db';

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

/** The values of `patch` that differ from the field row's, so a value sent unchanged is not written again. */
function changedValues(entry: SportEventParticipant, patch: SportEventParticipantPatch): SportEventParticipantPatch {
  const before = fieldUploadValues(entry);
  const changed: SportEventParticipantPatch = {};
  if (patch.isActive !== undefined && patch.isActive !== before.isActive) changed.isActive = patch.isActive;
  if (patch.inactiveReason !== undefined && patch.inactiveReason !== before.inactiveReason) changed.inactiveReason = patch.inactiveReason;
  if (patch.ranking !== undefined && patch.ranking !== before.ranking) changed.ranking = patch.ranking;
  if (patch.oddsToWin !== undefined && patch.oddsToWin !== before.oddsToWin) changed.oddsToWin = patch.oddsToWin;
  if (patch.seedNumber !== undefined && patch.seedNumber !== before.seedNumber) changed.seedNumber = patch.seedNumber;
  if (patch.isPlayInPlace !== undefined && patch.isPlayInPlace !== entry.isPlayInPlace) changed.isPlayInPlace = patch.isPlayInPlace;
  return changed;
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
  matches: Pick<SportEventMatchRepository, 'findBySportEvent'>;
  /** The fields read lately, shared by every instance of this service in the container; a new one when omitted. */
  fieldCache?: EventFieldCache;
  now?: () => Date;
  random?: () => number;
  logger?: FastifyBaseLogger;
}

/** An event's field as readers read it: now, from this container's cache, or batched for a fan-out. */
export type EventFieldReads = Pick<SportEventParticipantService, 'listEventParticipants' | 'listCachedEventParticipants' | 'batchedFieldReads'>;

export class SportEventParticipantService {
  private readonly fieldCache: EventFieldCache;

  constructor(private readonly deps: SportEventParticipantServiceDeps) {
    this.fieldCache = deps.fieldCache ?? new ReadCache();
  }

  /**
   * The field in seed order, unseeded last, read now in one repository call (#1163). What a
   * write answers with, and what settlement and the emails read. 404 EVENT_NOT_FOUND for an
   * unknown event.
   */
  async listEventParticipants(sportEventId: string): Promise<SportEventParticipantView[]> {
    const event = await this.requireEvent(sportEventId);
    return this.deps.field.findFieldForEvent(sportEventId, event.sportLeagueId);
  }

  /**
   * The same field, as viewers poll it (#1163): the one read in this container within the last
   * 30 seconds, else read now and kept. Every contest on the event shares it. A write through
   * the events routes or ingestion forgets it, so this container's next read is current.
   */
  listCachedEventParticipants(sportEventId: string): Promise<SportEventParticipantView[]> {
    return this.fieldCache.get(sportEventId, this.deps.now?.() ?? new Date(), () => this.listEventParticipants(sportEventId));
  }

  /**
   * The same two reads for one fan-out (#1315), batched: the fields asked for together are read
   * together, with their events, in the same few statements however many events. The cached
   * read still answers from this container's cache first.
   */
  batchedFieldReads(): EventFieldReads {
    const fields = new BatchedRead<string, SportEventParticipantView[]>(async (sportEventIds) => {
      const events = new Map((await this.deps.sportEvents.findByIds([...new Set(sportEventIds)])).map((event) => [event.id, event]));
      const missing = sportEventIds.find((sportEventId) => !events.has(sportEventId));
      if (missing !== undefined) {
        throw new SportEventError(`Sport event ${missing} was not found.`, 'EVENT_NOT_FOUND', 404);
      }
      const rows = await this.deps.field.findFieldsForEvents([...events.values()].map((event) => ({ sportEventId: event.id, sportLeagueId: event.sportLeagueId })));
      return sportEventIds.map((sportEventId) => rows.filter((row) => row.entry.sportEventId === sportEventId));
    });
    const reads: EventFieldReads = {
      listEventParticipants: (sportEventId) => fields.load(sportEventId),
      listCachedEventParticipants: (sportEventId) => this.fieldCache.get(sportEventId, this.deps.now?.() ?? new Date(), () => fields.load(sportEventId)),
      batchedFieldReads: () => reads,
    };
    return reads;
  }

  /**
   * One field row, read as the field reads each (#1163): what a write to one row answers with.
   * 404 EVENT_NOT_FOUND for an unknown event, EVENT_PARTICIPANT_NOT_FOUND for a row not on it.
   */
  async getEventParticipant(sportEventId: string, sportEventParticipantId: string): Promise<SportEventParticipantView> {
    const event = await this.requireEvent(sportEventId);
    const row = await this.deps.field.findFieldRow(sportEventId, sportEventParticipantId, event.sportLeagueId);
    if (!row) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} is not on sport event ${sportEventId}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    return row;
  }

  /**
   * Copies the event's sport league's active affiliations onto the field, deriving seed
   * numbers and odds for the ones added. Idempotent: participants already on the field
   * are skipped and keep what they have.
   */
  async seedFromSportLeague(sportEventId: string): Promise<SeedFieldResult> {
    const event = await this.requireEvent(sportEventId);
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
   * SPORT_EVENT_TIERS_LOCKED, #431), and neither does a seed on an event played as a bracket,
   * whose upset bonus reads the seeds as they stood at release (409 SPORT_EVENT_SEEDS_LOCKED,
   * #698). A seed sent unchanged is not a change. Marking a row as a play-in place (#709) is
   * only for a bracket event (422 SPORT_EVENT_NOT_BRACKET) before release (409
   * SPORT_EVENT_BRACKET_LOCKED); one sent unchanged is not a change.
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
    const field = await this.deps.field.findBySportEvent(sportEventId);
    const seedsLocked = eventPlaysMatches(event) && event.status !== SportEventStatus.DRAFT;
    if (seedsLocked) {
      const seedById = new Map(field.map((entry) => [entry.id, entry.seedNumber ?? null]));
      const reseeded = updates.filter((update) => update.seedNumber !== undefined
        && seedById.has(update.sportEventParticipantId)
        && update.seedNumber !== seedById.get(update.sportEventParticipantId));
      if (reseeded.length > 0) {
        this.deps.logger?.warn({ sportEventId, status: event.status, reseeded: reseeded.length }, 'Refused a seed change on a released bracket');
        throw new SportEventError(
          `Sport event ${sportEventId} has been released for contests, so its seeds are locked.`,
          'SPORT_EVENT_SEEDS_LOCKED',
          409,
        );
      }
    }
    const playInById = new Map(field.map((entry) => [entry.id, entry.isPlayInPlace]));
    const remarked = updates.filter((update) => update.isPlayInPlace !== undefined
      && playInById.has(update.sportEventParticipantId)
      && update.isPlayInPlace !== playInById.get(update.sportEventParticipantId));
    if (remarked.length > 0) {
      if (!eventPlaysMatches(event)) {
        this.deps.logger?.warn({ sportEventId, sport: event.sport }, 'Refused a play-in place on an event that plays no bracket');
        throw new SportEventError(
          `A ${getSportDefinition(event.sport).name.toLowerCase()} event is not played as a bracket, so it has no play-in places.`,
          'SPORT_EVENT_NOT_BRACKET',
          422,
        );
      }
      if (event.status !== SportEventStatus.DRAFT) {
        this.deps.logger?.warn({ sportEventId, status: event.status }, 'Refused a play-in place change on a released bracket');
        throw new SportEventError(
          `Sport event ${sportEventId} has been released for contests, so its play-in places are locked.`,
          'SPORT_EVENT_BRACKET_LOCKED',
          409,
        );
      }
    }
    const onField = new Set(field.map((entry) => entry.id));
    const notOnField = updates.filter((update) => !onField.has(update.sportEventParticipantId));
    if (notOnField.length > 0) {
      throw new SportEventError(
        `Not on sport event ${sportEventId}'s field: ${notOnField.map((update) => update.sportEventParticipantId).join(', ')}.`,
        'EVENT_PARTICIPANT_NOT_FOUND',
        404,
      );
    }
    // Only the values that change are written, so a grid saved with most rows untouched writes
    // little: the adapter writes one statement per distinct new value (#1252).
    const entryById = new Map(field.map((entry) => [entry.id, entry]));
    await this.deps.field.updateMany(updates.map(({ sportEventParticipantId, price, ...patch }) => {
      const entry = entryById.get(sportEventParticipantId);
      return { id: sportEventParticipantId, updates: entry ? changedValues(entry, patch) : patch, price };
    }));
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

  /**
   * Removes a field row. Refused (409) once any contest entry has picked it — withdraw instead —
   * and while a bracket match names it (#698).
   */
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
    const inBracket = (await this.deps.matches.findBySportEvent(sportEventId)).some((match) => (
      match.homeSportEventParticipantId === sportEventParticipantId || match.awaySportEventParticipantId === sportEventParticipantId
    ));
    if (inBracket) {
      throw new SportEventError(
        `Field row ${sportEventParticipantId} is in the event's bracket and cannot be removed — take it out of its match first.`,
        'EVENT_PARTICIPANT_IN_BRACKET',
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
}
