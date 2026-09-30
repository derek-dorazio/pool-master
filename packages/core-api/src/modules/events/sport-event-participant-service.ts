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
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantLeagueAffiliationRepository,
  ParticipantRepository,
  SeasonRepository,
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
import { SportEventError } from './errors';

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

export interface SportEventParticipantServiceDeps {
  sportEvents: SportEventRepository;
  field: SportEventParticipantRepository;
  participants: ParticipantRepository;
  seasons: SeasonRepository;
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
    const sportLeagueId = await this.sportLeagueIdOf(event);
    if (!sportLeagueId) {
      throw new SportEventError(
        `Sport event ${sportEventId} has no season, so it has no sport league to seed from.`,
        'EVENT_HAS_NO_SEASON',
        409,
      );
    }
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

  /** One save of the field grid: every patched row and its manual price, all or none. */
  async updateParticipants(sportEventId: string, updates: readonly FieldEntryUpdate[]): Promise<SportEventParticipantView[]> {
    await this.requireEvent(sportEventId);
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

  private async sportLeagueIdOf(event: SportEvent): Promise<string | null> {
    if (!event.seasonId) return null;
    return (await this.deps.seasons.findById(event.seasonId))?.sportLeagueId ?? null;
  }

  private async affiliatedParticipantIds(event: SportEvent): Promise<Set<string>> {
    const sportLeagueId = await this.sportLeagueIdOf(event);
    if (!sportLeagueId) return new Set();
    return new Set((await this.deps.affiliations.findBySportLeague(sportLeagueId)).map((affiliation) => affiliation.participantId));
  }
}
