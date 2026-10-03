/**
 * SportLeagueService — cross-sport SportLeague CRUD and the sport league's
 * affiliations: who competes in it, and their current ranking there
 * (plans/124 §3.2/§4.2). Nothing here is golf-shaped; the golf admin routes
 * call it scoped to Sport.GOLF, and another sport reuses it unchanged.
 *
 * Affiliation is sport-league-scoped, not year-scoped — a competitor's
 * membership and ranking don't reset every year (plans/124 §4.2).
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantLeagueAffiliationRepository,
  ParticipantRanking,
  ParticipantRepository,
  SportEventRepository,
  SportLeagueRepository,
  SportLeagueUpdate,
  SportRepository,
} from '@poolmaster/shared/db';
import type {
  ParticipantLeagueAffiliation,
  Sport,
  SportLeague,
} from '@poolmaster/shared/domain';
import { SportCatalogError } from './errors';
import { requireSport } from './sport-row';
import { resolveParticipantRow, type ParticipantRowResolution } from './participant-row-resolver';

/** A sport league with the two counts its list is read for. */
export interface SportLeagueSummary extends SportLeague {
  affiliationCount: number;
  /** Events across every series of the sport league, every year. */
  sportEventCount: number;
}

export interface AffiliationUploadRow {
  participantId?: string;
  externalId?: string;
  playerName?: string;
  ranking?: number;
}

export type AffiliationUploadResolution = ParticipantRowResolution;

export interface AffiliationUploadPreviewRow {
  row: AffiliationUploadRow;
  resolution: AffiliationUploadResolution;
  participantId: string | null;
  participantName: string | null;
}

export interface SportLeagueServiceDeps {
  sports: SportRepository;
  sportLeagues: SportLeagueRepository;
  sportEvents: SportEventRepository;
  affiliations: ParticipantLeagueAffiliationRepository;
  participants: ParticipantRepository;
  logger?: FastifyBaseLogger;
}

export class SportLeagueService {
  constructor(private readonly deps: SportLeagueServiceDeps) {}

  /** Every sport league, or one sport's; the one list that takes a sport (#203 stage 2, decision 5). */
  async listSportLeagues(filters: { sport?: Sport; isActive?: boolean } = {}): Promise<SportLeagueSummary[]> {
    const sportId = filters.sport ? (await requireSport(this.deps.sports, filters.sport)).id : undefined;
    return this.summarize(await this.deps.sportLeagues.findAll({ sportId, isActive: filters.isActive }));
  }

  async getSportLeague(sportLeagueId: string): Promise<SportLeagueSummary | null> {
    const sportLeague = await this.deps.sportLeagues.findById(sportLeagueId);
    return sportLeague ? (await this.summarize([sportLeague]))[0] : null;
  }

  async createSportLeague(sport: Sport, input: { name: string; matchKeyword?: string }): Promise<SportLeagueSummary> {
    const sportRow = await requireSport(this.deps.sports, sport);
    if (await this.deps.sportLeagues.findBySportAndName(sportRow.id, input.name)) {
      throw new SportCatalogError(
        `A sport league named "${input.name}" already exists for ${sport}.`,
        'SPORT_LEAGUE_NAME_ALREADY_EXISTS',
        409,
      );
    }
    const sportLeague = await this.deps.sportLeagues.create({
      sportId: sportRow.id,
      name: input.name,
      matchKeyword: input.matchKeyword ?? null,
    });
    this.deps.logger?.info({ sportLeagueId: sportLeague.id, sport, name: input.name }, 'Created sport league');
    return (await this.summarize([sportLeague]))[0];
  }

  /**
   * 404 SPORT_LEAGUE_NOT_FOUND for an unknown sport league.
   *
   * Setting `currentEventYear` is "set as current" (plans/147 decision 6). It replaced a
   * foreign key to a season, which made the database guarantee the target existed; a plain
   * year column accepts 1823. So the guarantee is kept here instead: 422
   * EVENT_YEAR_HAS_NO_EVENTS for a year this sport league has no events in. It is one write
   * on the sport league row, so the sport league never has two current years.
   */
  async updateSportLeague(
    sportLeagueId: string,
    updates: Pick<SportLeagueUpdate, 'name' | 'matchKeyword' | 'isActive'> & { currentEventYear?: number },
  ): Promise<SportLeagueSummary> {
    const sportLeague = await this.requireSportLeague(sportLeagueId);
    if (updates.currentEventYear !== undefined) {
      const events = (await this.deps.sportEvents.countBySportLeagues([sportLeagueId], { eventYear: updates.currentEventYear }))
        .get(sportLeagueId) ?? 0;
      if (events === 0) {
        throw new SportCatalogError(
          `${sportLeague.name} has no events in ${updates.currentEventYear}, so it cannot be the current year.`,
          'EVENT_YEAR_HAS_NO_EVENTS',
          422,
        );
      }
    }
    const updated = await this.deps.sportLeagues.update(sportLeagueId, {
      name: updates.name,
      matchKeyword: updates.matchKeyword,
      isActive: updates.isActive,
      currentEventYear: updates.currentEventYear,
    });
    if (updates.currentEventYear !== undefined) {
      this.deps.logger?.info({ sportLeagueId, currentEventYear: updates.currentEventYear }, 'Set current event year');
    }
    return (await this.summarize([updated]))[0];
  }

  /** 404 SPORT_LEAGUE_NOT_FOUND for an unknown sport league. */
  async listAffiliations(sportLeagueId: string): Promise<ParticipantLeagueAffiliation[]> {
    await this.requireSportLeague(sportLeagueId);
    return this.deps.affiliations.findBySportLeague(sportLeagueId);
  }

  async addAffiliation(sportLeagueId: string, participantId: string): Promise<ParticipantLeagueAffiliation> {
    await this.requireSportLeague(sportLeagueId);
    if (await this.deps.affiliations.find(sportLeagueId, participantId)) {
      throw new SportCatalogError(
        'This participant is already affiliated with the sport league.',
        'SPORT_LEAGUE_AFFILIATION_ALREADY_EXISTS',
        409,
      );
    }
    return this.deps.affiliations.create(sportLeagueId, participantId);
  }

  async removeAffiliation(sportLeagueId: string, participantId: string): Promise<void> {
    if (!(await this.deps.affiliations.find(sportLeagueId, participantId))) {
      throw new SportCatalogError(
        'This participant is not affiliated with the sport league.',
        'SPORT_LEAGUE_AFFILIATION_NOT_FOUND',
        404,
      );
    }
    await this.deps.affiliations.delete(sportLeagueId, participantId);
  }

  async updateRankings(
    sportLeagueId: string,
    rankings: readonly ParticipantRanking[],
  ): Promise<ParticipantLeagueAffiliation[]> {
    await this.deps.affiliations.updateRankings(sportLeagueId, rankings);
    return this.listAffiliations(sportLeagueId);
  }

  /**
   * Dry run — resolves each row to an existing Participant of the sport league's
   * sport (participantId, then externalId, then an exact case-insensitive name),
   * writing nothing. Never creates a Participant from a row.
   */
  async previewAffiliationUpload(
    sportLeagueId: string,
    rows: AffiliationUploadRow[],
  ): Promise<AffiliationUploadPreviewRow[]> {
    const sportLeague = await this.deps.sportLeagues.findById(sportLeagueId);
    if (!sportLeague) {
      throw new SportCatalogError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    return Promise.all(rows.map((row) => this.resolveUploadRow(sportLeague.sportId, row)));
  }

  /** Applies a previewed upload. Throws when any row is unresolved — all or nothing. */
  async applyAffiliationUpload(
    sportLeagueId: string,
    rows: AffiliationUploadRow[],
  ): Promise<ParticipantLeagueAffiliation[]> {
    const preview = await this.previewAffiliationUpload(sportLeagueId, rows);
    const unresolved = preview.filter((row) => row.resolution !== 'MATCHED');
    if (unresolved.length > 0) {
      throw new SportCatalogError(
        `${unresolved.length} upload row(s) could not be resolved to a participant.`,
        'SPORT_LEAGUE_AFFILIATION_UPLOAD_UNRESOLVED_ROWS',
        422,
      );
    }
    await this.deps.affiliations.upsertRankings(sportLeagueId, preview.map((resolved) => ({
      participantId: resolved.participantId as string,
      ranking: resolved.row.ranking ?? null,
    })));
    return this.listAffiliations(sportLeagueId);
  }

  private async resolveUploadRow(sportId: string, row: AffiliationUploadRow): Promise<AffiliationUploadPreviewRow> {
    const { resolution, participant } = await resolveParticipantRow(
      row,
      (query) => this.deps.participants.findMatching(sportId, query),
    );
    return { row, resolution, participantId: participant?.id ?? null, participantName: participant?.name ?? null };
  }

  private async requireSportLeague(sportLeagueId: string): Promise<SportLeague> {
    const sportLeague = await this.deps.sportLeagues.findById(sportLeagueId);
    if (!sportLeague) {
      throw new SportCatalogError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    return sportLeague;
  }

  private async summarize(sportLeagues: SportLeague[]): Promise<SportLeagueSummary[]> {
    const ids = sportLeagues.map((sportLeague) => sportLeague.id);
    const [affiliationCounts, eventCounts] = await Promise.all([
      this.deps.affiliations.countBySportLeagues(ids),
      this.deps.sportEvents.countBySportLeagues(ids),
    ]);
    return sportLeagues.map((sportLeague) => ({
      ...sportLeague,
      affiliationCount: affiliationCounts.get(sportLeague.id) ?? 0,
      sportEventCount: eventCounts.get(sportLeague.id) ?? 0,
    }));
  }
}
