/**
 * An event's games, the field playing them and the entries' game picks, kept as rows, beside an
 * `InMemoryContestWorld` — for the prediction contest tests (#716 pick'em, #721 bracket).
 *
 * As the world does, each repository mirrors its Prisma adapter: the picks come back in game
 * order, a save is all or none and stamps the week's status, and the tiebreaker is written to the
 * entry's row for the event in the same change (#717). A defect in the adapter's query itself still needs a real-database test.
 *
 * Scaffolding only: no assertions and no test-specific data here.
 */
import type {
  ContestEntryMatchPredictionRepository,
  ContestEntrySeasonPrediction,
  LockedPredictionWeek,
  ParticipantRepository,
  SportEventRoundMatchRepository,
  SportEventParticipantRepository,
} from '@poolmaster/shared/db';
import {
  compareMatchPlaces,
  matchParticipantIds,
  ContestEntryStatus,
  MatchStatus,
  ParticipantStatus,
  PeriodUnit,
  PredictedResult,
  type BackgroundJobRequest,
  type ContestEntryMatchPrediction,
  type Participant,
  type SportEventRoundMatch,
  type SportEventParticipant,
} from '@poolmaster/shared/domain';
import { weekRoundSlot } from './round-slots';
import { legacyMatch } from './match-sides';
import { expectDefined } from './expect-defined';
import type { EventFieldReads } from '../../packages/core-api/src/modules/events/sport-event-participant-service';
import { fieldReads } from './field-reads';
import type { InMemoryContestWorld } from './in-memory-contest-world';

const T0 = new Date('2026-09-01T00:00:00.000Z');

export class InMemoryGamePicks {
  readonly matches = new Map<string, SportEventRoundMatch>();
  readonly field = new Map<string, SportEventParticipant>();
  readonly participants = new Map<string, Participant>();
  readonly predictions = new Map<string, ContestEntryMatchPrediction>();
  /** The side number each stored pick was written with (#2046), by prediction id; null for a tie pick. */
  readonly pickedSideNumbers = new Map<string, number | null>();
  /** The background jobs each save wrote with its picks (#1466), as the adapter inserts them in its transaction. */
  readonly writtenJobs: BackgroundJobRequest[] = [];
  private sequence = 0;

  constructor(private readonly world: InMemoryContestWorld) {}

  /**
   * A team in the event's field. `id` names the field row; by default it is numbered. `participantId`
   * puts a team already in another event's field into this one, as each week's field holds the same
   * teams; by default the team is new.
   */
  addTeam(sportEventId: string, name: string, options: { id?: string; seedNumber?: number; participantId?: string } = {}): SportEventParticipant {
    this.sequence += 1;
    const participant = options.participantId !== undefined ? expectDefined(this.participants.get(options.participantId)) : {
      id: `participant-${this.sequence}`,
      sportLeagueId: 'sport-league-nfl',
      ranking: null,
      name,
      participantType: 'TEAM',
      status: ParticipantStatus.ACTIVE,
      createdAt: T0,
      updatedAt: T0,
    } as Participant;
    this.participants.set(participant.id, participant);
    const row: SportEventParticipant = {
      id: options.id ?? `field-${this.sequence}`,
      sportEventId,
      participantId: participant.id,
      isActive: true,
      isPlayInPlace: false,
      ...(options.seedNumber !== undefined && { seedNumber: options.seedNumber }),
      metadata: {},
      createdAt: T0,
      updatedAt: T0,
    };
    this.field.set(row.id, row);
    return row;
  }

  /** A first-round game between two new teams, or between two teams already playing (`teams`, their participant ids). */
  addGame(
    sportEventId: string,
    matchNumber: number,
    kickoff: Date | null,
    status: MatchStatus = MatchStatus.SCHEDULED,
    teams?: { home: string; away: string },
  ): SportEventRoundMatch {
    const home = this.addTeam(sportEventId, `Home ${matchNumber}`, { participantId: teams?.home });
    const away = this.addTeam(sportEventId, `Away ${matchNumber}`, { participantId: teams?.away });
    const match = legacyMatch({
      id: `game-${matchNumber}`,
      sportEventId,
      roundNumber: 1,
      // A football week's game, played in four quarters (#2047).
      slot: { ...weekRoundSlot(), periods: { unit: PeriodUnit.QUARTER, count: 4 } },
      matchNumber,
      homeSportEventParticipantId: home.id,
      awaySportEventParticipantId: away.id,
      scheduledDate: kickoff,
      status,
      createdAt: T0,
      updatedAt: T0,
    });
    this.matches.set(match.id, match);
    return match;
  }

  /** Stores games as they are, replacing any with the same id: a bracket, or its results. */
  putMatches(matches: readonly SportEventRoundMatch[]): void {
    for (const match of matches) this.matches.set(match.id, match);
  }

  /**
   * Stores a bracket and a field row for every team it names, the row id being the team's id and
   * its seed taken from `seedOf`.
   */
  addBracket(matches: readonly SportEventRoundMatch[], seedOf: ReadonlyMap<string, number | null>): void {
    this.putMatches(matches);
    for (const match of matches) {
      for (const team of matchParticipantIds(match)) {
        if (this.field.has(team)) continue;
        this.addTeam(match.sportEventId, `Team ${team}`, { id: team, seedNumber: seedOf.get(team) ?? undefined });
      }
    }
  }

  matchRepo(): Pick<SportEventRoundMatchRepository, 'findById' | 'findBySportEvent' | 'findBySportEvents'> {
    const findBySportEvents = async (sportEventIds: readonly string[]) => [...this.matches.values()]
      .filter((match) => sportEventIds.includes(match.sportEventId))
      .sort((left, right) => left.sportEventId.localeCompare(right.sportEventId) || compareMatchPlaces(left, right));
    return {
      findById: async (id) => this.matches.get(id) ?? null,
      findBySportEvent: async (sportEventId) => findBySportEvents([sportEventId]),
      findBySportEvents,
    };
  }

  fieldRepo(): Pick<SportEventParticipantRepository, 'findByIds' | 'findBySportEvent' | 'countDistinctParticipants'> {
    return {
      findByIds: async (ids) => ids.flatMap((id) => this.field.get(id) ?? []),
      findBySportEvent: async (sportEventId) =>
        [...this.field.values()].filter((row) => row.sportEventId === sportEventId),
      countDistinctParticipants: async (sportEventIds) => new Set([...this.field.values()]
        .filter((row) => sportEventIds.includes(row.sportEventId))
        .map((row) => row.participantId)).size,
    };
  }

  /**
   * The event's field as the field service publishes it: only the rows, their teams and their
   * seeds matter here. Nothing is kept, so the shared read is the current one too.
   */
  fieldService(): EventFieldReads {
    const listEventParticipants = async (sportEventId: string) => [...this.field.values()]
      .filter((row) => row.sportEventId === sportEventId)
      .map((row) => ({
        entry: row,
        participant: expectDefined(this.participants.get(row.participantId)),
        valuation: null,
        standing: null,
        rounds: [],
        raceResult: null,
        matches: [],
        affiliatedWithSportLeague: true,
      }));
    return fieldReads(listEventParticipants);
  }

  participantRepo(): Pick<ParticipantRepository, 'findByIds'> {
    return { findByIds: async (ids) => ids.flatMap((id) => this.participants.get(id) ?? []) };
  }

  private inEvent(row: ContestEntryMatchPrediction, sportEventId: string): boolean {
    return this.matches.get(row.sportEventRoundMatchId)?.sportEventId === sportEventId;
  }

  /** The pick's game's round and number: picks read in game order, round first, as the Prisma adapter orders them. */
  private matchOf(row: ContestEntryMatchPrediction): SportEventRoundMatch {
    return expectDefined(this.matches.get(row.sportEventRoundMatchId));
  }

  /** Mirrors the adapter: all or none, unique per entry and game, confidence at least 1, the week's status and tiebreaker written with the picks. */
  predictionRepo(): ContestEntryMatchPredictionRepository {
    const key = (entryId: string, matchId: string) => `${entryId}:${matchId}`;
    return {
      findByEntryAndEvent: async (contestEntryId, sportEventId) => [...this.predictions.values()]
        .filter((row) => row.contestEntryId === contestEntryId && this.inEvent(row, sportEventId))
        .sort((left, right) => compareMatchPlaces(this.matchOf(left), this.matchOf(right))),
      findByEntriesAndEvent: async (contestEntryIds, sportEventId) => [...this.predictions.values()]
        .filter((row) => contestEntryIds.includes(row.contestEntryId) && this.inEvent(row, sportEventId))
        .sort((left, right) => compareMatchPlaces(this.matchOf(left), this.matchOf(right))
          || left.contestEntryId.localeCompare(right.contestEntryId)),
      findByEntriesAndEvents: async (contestEntryIds, sportEventIds) => [...this.predictions.values()]
        .filter((row) => contestEntryIds.includes(row.contestEntryId)
          && sportEventIds.some((sportEventId) => this.inEvent(row, sportEventId)))
        .map((row): ContestEntrySeasonPrediction => {
          const sportEventId = expectDefined(this.matches.get(row.sportEventRoundMatchId)).sportEventId;
          return row.predictedResult === PredictedResult.TIE
            ? { ...row, sportEventId, participantId: null }
            : { ...row, sportEventId, participantId: expectDefined(this.field.get(row.sportEventParticipantId)).participantId };
        }),
      hasAnyOnMatch: async (sportEventRoundMatchId) => [...this.predictions.values()].some((row) => row.sportEventRoundMatchId === sportEventRoundMatchId),
      save: async ({ contestEntryId, sportEventId, at: when, decide }) => {
        const week = (): LockedPredictionWeek => ({
          predictions: [...this.predictions.values()]
            .filter((row) => row.contestEntryId === contestEntryId && this.inEvent(row, sportEventId))
            .sort((left, right) => compareMatchPlaces(this.matchOf(left), this.matchOf(right))),
          event: expectDefined(this.world.entries.get(contestEntryId)).events.find((event) => event.sportEventId === sportEventId) ?? null,
        });
        const change = decide(week());
        if (change === null) return { written: null, week: week() };
        const { saves, clearedMatchIds, eventStatus, tiebreakerValue, jobs = [] } = change;
        if (saves.some((save) => save.confidence !== null && save.confidence < 1)) {
          throw new Error('violates check constraint contest_entry_match_predictions_confidence_check');
        }
        for (const matchId of clearedMatchIds) this.predictions.delete(key(contestEntryId, matchId));
        for (const { sideNumber, ...save } of saves) {
          const existing = this.predictions.get(key(contestEntryId, save.sportEventRoundMatchId));
          const id = existing?.id ?? `prediction-${contestEntryId}-${save.sportEventRoundMatchId}`;
          this.pickedSideNumbers.set(id, sideNumber);
          this.predictions.set(key(contestEntryId, save.sportEventRoundMatchId), {
            id,
            contestEntryId,
            ...save,
            pickedAt: when,
            createdAt: existing?.createdAt ?? when,
            updatedAt: when,
          });
        }
        if (eventStatus !== null) {
          this.world.setEntryEventStatus(contestEntryId, sportEventId, eventStatus, when);
        }
        if (tiebreakerValue !== undefined) {
          // On the entry's row for the event, created as a draft when it has none.
          const entry = expectDefined(this.world.entries.get(contestEntryId));
          const row = entry.events.find((event) => event.sportEventId === sportEventId) ?? { sportEventId, status: ContestEntryStatus.DRAFT };
          this.world.entries.set(contestEntryId, {
            ...entry,
            events: [
              ...entry.events.filter((event) => event.sportEventId !== sportEventId),
              { ...row, tiebreakerValue: tiebreakerValue ?? undefined },
            ],
          });
        }
        this.writtenJobs.push(...jobs);
        return { written: change, week: week() };
      },
    };
  }
}
