/**
 * Repository ports for the cross-sport catalog and event core (#235). Each covers its
 * entity's full operation set, including the unscoped reads a root admin needs (access
 * rule A1): the catalog is reference data, narrowed by filters, never paged (§16).
 */

import type {
  ParticipantLeagueAffiliation,
  Season,
  Sport,
  SportConfig,
  SportEvent,
  SportEventParticipantRound,
  SportEventParticipantStanding,
  SportEventRound,
  SportEventStatus,
  SportLeague,
} from '../domain';

export interface SportRepository {
  findById(id: string): Promise<SportConfig | null>;
  findByName(name: Sport): Promise<SportConfig | null>;
  findAll(): Promise<SportConfig[]>;
}

export interface SportLeagueFilters {
  sportId?: string;
  isActive?: boolean;
}

export type SportLeagueUpdate = Partial<Pick<SportLeague, 'name' | 'matchKeyword' | 'isActive' | 'currentSeasonId'>>;

export interface SportLeagueRepository {
  findById(id: string): Promise<SportLeague | null>;
  /** Ordered by name. */
  findAll(filters: SportLeagueFilters): Promise<SportLeague[]>;
  findBySportAndName(sportId: string, name: string): Promise<SportLeague | null>;
  create(input: Pick<SportLeague, 'sportId' | 'name' | 'matchKeyword'>): Promise<SportLeague>;
  update(id: string, updates: SportLeagueUpdate): Promise<SportLeague>;
}

export interface SeasonFilters {
  sportId?: string;
  sportLeagueId?: string;
  isActive?: boolean;
}

export type SeasonUpdate = Partial<Pick<Season, 'name' | 'startDate' | 'endDate' | 'isActive'>>;

export interface SeasonRepository {
  findById(id: string): Promise<Season | null>;
  /** Ordered by sport league, then most recent year first. */
  findAll(filters: SeasonFilters): Promise<Season[]>;
  findBySportLeagueAndYear(sportLeagueId: string, year: number): Promise<Season | null>;
  create(input: Pick<Season, 'sportLeagueId' | 'name' | 'year' | 'startDate' | 'endDate'>): Promise<Season>;
  update(id: string, updates: SeasonUpdate): Promise<Season>;
  /** Seasons per sport league, for each id asked about (0 where none). */
  countBySportLeagues(sportLeagueIds: readonly string[]): Promise<Map<string, number>>;
}

export interface ParticipantRanking {
  participantId: string;
  ranking: number | null;
}

export interface ParticipantLeagueAffiliationRepository {
  /** Best rank first, unranked last, then by participant name. */
  findBySportLeague(sportLeagueId: string): Promise<ParticipantLeagueAffiliation[]>;
  find(sportLeagueId: string, participantId: string): Promise<ParticipantLeagueAffiliation | null>;
  create(sportLeagueId: string, participantId: string): Promise<ParticipantLeagueAffiliation>;
  delete(sportLeagueId: string, participantId: string): Promise<void>;
  /** Re-ranks existing affiliations, all or none. */
  updateRankings(sportLeagueId: string, rankings: readonly ParticipantRanking[]): Promise<void>;
  /** Creates missing affiliations and re-ranks existing ones, all or none. */
  upsertRankings(sportLeagueId: string, rankings: readonly ParticipantRanking[]): Promise<void>;
  /** Affiliations per sport league, for each id asked about (0 where none). */
  countBySportLeagues(sportLeagueIds: readonly string[]): Promise<Map<string, number>>;
}

export interface SportEventFilters {
  sport?: Sport;
  status?: SportEventStatus;
  seasonId?: string;
}

export interface SportEventRepository {
  findById(id: string): Promise<SportEvent | null>;
  /** Ordered by start date, then name. */
  findAll(filters: SportEventFilters): Promise<SportEvent[]>;
  /** Event participants per event, for each id asked about (0 where none). */
  countParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>>;  /** Events per season, for each id asked about (0 where none). */
  countBySeasons(seasonIds: readonly string[]): Promise<Map<string, number>>;
}

export interface SportEventRoundRepository {
  /** Ordered by round number. */
  findBySportEvent(sportEventId: string): Promise<SportEventRound[]>;
}

export interface SportEventParticipantRoundRepository {
  /** Ordered by round number. */
  findBySportEventParticipant(sportEventParticipantId: string): Promise<SportEventParticipantRound[]>;
  findBySportEventRound(sportEventRoundId: string): Promise<SportEventParticipantRound[]>;
}

export interface SportEventParticipantStandingRepository {
  /** Best position first, unranked last. Position is direction-free: 1 is best in every sport. */
  findBySportEvent(sportEventId: string): Promise<SportEventParticipantStanding[]>;
  findBySportEventParticipant(sportEventParticipantId: string): Promise<SportEventParticipantStanding | null>;
}

/** Candidate participants for an upload row, within one sport. Exact match on each identifier given. */
export interface ParticipantMatchQuery {
  id?: string;
  externalId?: string;
  /** Case-insensitive exact name. */
  name?: string;
}

