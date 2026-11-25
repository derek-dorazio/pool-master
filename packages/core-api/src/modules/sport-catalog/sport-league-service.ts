/**
 * SportLeagueService — cross-sport SportLeague CRUD and the sport league's roster: its
 * participants, each of whom belongs to it alone (#1853), and their current ranking there.
 * Nothing here is golf-shaped.
 *
 * A ranking is sport-league-scoped, not year-scoped: it does not reset every year.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantRanking,
  ParticipantRepository,
  PlatformPricingProfileRepository,
  SportEventRepository,
  SportLeagueRepository,
  SportLeagueSeasonRepository,
  SportLeagueUpdate,
  SportLeagueUses,
  SportRepository,
  PlatformTierProfileRepository,
  ParticipantProviderMappingRepository,
} from '@poolmaster/shared/db';
import {
  BracketAdvancement,
  getSportDefinition,
  isKnownTimeZone,
  sportPlaysMatches,
  type Participant,
  type ProviderCode,
  type ProviderLeagueSettings,
  type ProviderSettings,
  type Sport,
  type SportConfig,
  type SportLeaguePlay,
  type SportLeague,
  type SportLeagueSeasonSlot,
  type SportLeagueSeasonSpan,
} from '@poolmaster/shared/domain';
import { SportCatalogError } from './errors';
import { requireSport } from './sport-row';
import { feedIdsOfCandidates, matchAmong, participantMatchQuery, resolveParticipantRow, type ParticipantRowResolution } from './participant-row-resolver';

/** A sport league with its sport and the two counts its list is read for. */
export interface SportLeagueSummary extends SportLeague {
  sport: Sport;
  /** Its sport's stored URL segment and display order (#2042), read from the sport row. */
  sportUrlSegment: string;
  sportDisplayOrder: number;
  participantCount: number;
  /** Events of the sport league, every year. */
  sportEventCount: number;
}

export interface RankingUploadRow {
  participantId?: string;
  externalId?: string;
  playerName?: string;
  ranking?: number;
}

export type RankingUploadResolution = ParticipantRowResolution;

export interface RankingUploadPreviewRow {
  row: RankingUploadRow;
  resolution: RankingUploadResolution;
  participantId: string | null;
  participantName: string | null;
}

/**
 * The providers as far as a sport league's event sync needs them (#1997): a provider league by id
 * with its provider (the `ProviderSettingsStore`), and whether that provider is running here and
 * reads that league (the app's `ProviderRegistry`, by Provider code, #2073).
 */
export interface SportDataProviderLookup {
  findLeague(providerLeagueId: string): { provider: Pick<ProviderSettings, 'code' | 'name' | 'isEnabled'>; league: Pick<ProviderLeagueSettings, 'sport' | 'isEnabled' | 'code'> } | undefined;
  /** Whether the Provider's adapter is running here and reads its league with this code. */
  readsLeague(providerCode: ProviderCode, providerLeagueCode: string): boolean;
}

export interface SportLeagueServiceDeps {
  sports: SportRepository;
  sportLeagues: SportLeagueRepository;
  sportEvents: SportEventRepository;
  participants: ParticipantRepository;
  /** Where a labelled test slot is added (#2004). */
  seasons: Pick<SportLeagueSeasonRepository, 'createTestSlot'>;
  /** The participants' provider mappings, read when an upload row names a feed id (#2040). */
  mappings: Pick<ParticipantProviderMappingRepository, 'findByParticipantIds'>;
  /** Which providers can sync a sport league's events (ADR 0011). */
  providers: SportDataProviderLookup;
  /** The profiles a sport league names one of each (#1844). */
  platformTierProfiles: Pick<PlatformTierProfileRepository, 'findById'>;
  platformPricingProfiles: Pick<PlatformPricingProfileRepository, 'findById'>;
  logger?: FastifyBaseLogger;
  /** The clock a new sport league's first Season is read from; the system clock by default. */
  now?: () => Date;
}

/** The two profiles a sport league names (#1844). */
export interface SportLeagueProfileIds {
  platformTierProfileId: string;
  platformPricingProfileId: string;
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

  /**
   * 422 SPORT_LEAGUE_NOT_BRACKET for a reseeded sport league of a sport not played as a bracket;
   * 404 PLATFORM_TIER_PROFILE_NOT_FOUND or PLATFORM_PRICING_PROFILE_NOT_FOUND for a profile that does not exist;
   * 400 TIME_ZONE_UNKNOWN for a time zone the runtime does not know (#2003). It starts with this
   * calendar year's Season as its current one, so an event can be made on it; every later Season
   * is added by migration. That first Season is a stopgap for the browser journeys' own leagues and
   * goes when they move to test slots (#2004).
   */
  async createSportLeague(
    sport: Sport,
    input: { name: string; urlSegment: string; timeZone: string; bracketAdvancement?: BracketAdvancement } & SportLeaguePlay & SportLeagueProfileIds,
  ): Promise<SportLeagueSummary> {
    if (!isKnownTimeZone(input.timeZone)) {
      throw new SportCatalogError(`Unknown time zone: ${input.timeZone}.`, 'TIME_ZONE_UNKNOWN', 400);
    }
    const sportRow = await requireSport(this.deps.sports, sport);
    this.assertAdvancementFits(sport, input.bracketAdvancement);
    await this.assertProfilesExist(input);
    if (await this.deps.sportLeagues.findBySportAndName(sportRow.id, input.name)) {
      throw new SportCatalogError(
        `A sport league named "${input.name}" already exists for ${sport}.`,
        'SPORT_LEAGUE_NAME_ALREADY_EXISTS',
        409,
      );
    }
    if (await this.deps.sportLeagues.findBySportAndUrlSegment(sportRow.id, input.urlSegment)) {
      throw new SportCatalogError(
        `A sport league of ${sport} already has the URL segment "${input.urlSegment}".`,
        'SPORT_LEAGUE_URL_SEGMENT_ALREADY_EXISTS',
        409,
      );
    }
    const sportLeague = await this.deps.sportLeagues.create({
      sportId: sportRow.id,
      name: input.name,
      urlSegment: input.urlSegment,
      participantType: input.participantType,
      scoringFamily: input.scoringFamily,
      timeZone: input.timeZone,
      bracketAdvancement: input.bracketAdvancement ?? BracketAdvancement.FIXED,
      platformTierProfileId: input.platformTierProfileId,
      platformPricingProfileId: input.platformPricingProfileId,
    }, calendarYearSeason((this.deps.now ?? (() => new Date()))()));
    this.deps.logger?.info({ sportLeagueId: sportLeague.id, sport, name: input.name }, 'Created sport league');
    return (await this.summarize([sportLeague]))[0];
  }

  /**
   * A labelled test slot of one of the league's slot definitions, in its current Season (#2004,
   * plan §2): QA's test events are made on these, and the sync never reads or writes them. 404
   * SPORT_LEAGUE_NOT_FOUND, SLOT_DEFINITION_NOT_FOUND; 422 SPORT_LEAGUE_HAS_NO_SEASON,
   * TEST_SLOT_ENDS_BEFORE_START, SLOT_PHASE_NOT_IN_SEASON; 409 TEST_SLOT_LABEL_TAKEN.
   */
  async createTestSlot(
    sportLeagueId: string,
    input: { slotDefinitionId: string; label: string; startsAt: Date; endsAt: Date | null },
  ): Promise<SportLeagueSeasonSlot> {
    const sportLeague = await this.deps.sportLeagues.findById(sportLeagueId);
    if (!sportLeague) throw new SportCatalogError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    if (sportLeague.currentSeasonId === null) {
      throw new SportCatalogError(`${sportLeague.name} has no current Season.`, 'SPORT_LEAGUE_HAS_NO_SEASON', 422);
    }
    if (input.endsAt !== null && input.endsAt.getTime() <= input.startsAt.getTime()) {
      throw new SportCatalogError('A test slot must end after it starts.', 'TEST_SLOT_ENDS_BEFORE_START', 422);
    }
    const created = await this.deps.seasons.createTestSlot({ ...input, sportLeagueId, sportLeagueSeasonId: sportLeague.currentSeasonId });
    if (created.outcome === 'LABEL_TAKEN') {
      throw new SportCatalogError(`The current Season already has a test slot labelled "${input.label}" on that definition.`, 'TEST_SLOT_LABEL_TAKEN', 409);
    }
    if (created.outcome === 'DEFINITION_NOT_FOUND') {
      throw new SportCatalogError(`Slot definition ${input.slotDefinitionId} is not one of ${sportLeague.name}'s.`, 'SLOT_DEFINITION_NOT_FOUND', 404);
    }
    if (created.outcome === 'PHASE_NOT_IN_SEASON') {
      throw new SportCatalogError(`${sportLeague.name}'s current Season does not have the phase slot definition ${input.slotDefinitionId} is in.`, 'SLOT_PHASE_NOT_IN_SEASON', 422);
    }
    const { slot } = created;
    this.deps.logger?.info({ sportLeagueId, sportLeagueSeasonId: sportLeague.currentSeasonId, seasonSlotId: slot.id, label: input.label }, 'Created test slot');
    return slot;
  }

  /**
   * 404 SPORT_LEAGUE_NOT_FOUND for an unknown sport league. Its current Season is never set here:
   * the daily recompute sets it (#2003).
   *
   * 422 SPORT_LEAGUE_NOT_BRACKET for RESEED_BY_SEED on a sport not played as a bracket. 409
   * SPORT_LEAGUE_BRACKET_ADVANCEMENT_LOCKED for a change of `bracketAdvancement` while any event of
   * the sport league has a bracket loaded (#730): a loaded bracket's links were drawn for the rule
   * it had, so switching a reseeded bracket to fixed would strand the winners of its unlinked
   * games. Sending the rule the league already has changes nothing and is allowed.
   *
   * `syncProviderLeagueId` turns the league's event sync on with a provider league, mapping the
   * league to it when it is not yet, or off with null (ADR 0011, #1997): 404
   * PROVIDER_LEAGUE_NOT_FOUND for one that does not exist, 422 PROVIDER_SPORT_MISMATCH for one of
   * another sport, and 422 PROVIDER_NOT_FOUND while it or its provider is switched off or not
   * running here.
   *
   * `platformTierProfileId` and `platformPricingProfileId` pick the league's profiles (#1844): 404
   * PLATFORM_TIER_PROFILE_NOT_FOUND or PLATFORM_PRICING_PROFILE_NOT_FOUND for one that does not exist. An event
   * already made keeps its tiers; its next auto-tiering and a never-priced field's next pricing
   * read the new profile.
   */
  async updateSportLeague(
    sportLeagueId: string,
    updates: Pick<SportLeagueUpdate, 'name' | 'isActive' | 'bracketAdvancement' | 'syncProviderLeagueId' | 'autoReleaseDaysBeforeStart' | 'platformTierProfileId' | 'platformPricingProfileId'>
  ): Promise<SportLeagueSummary> {
    const sportLeague = await this.requireSportLeague(sportLeagueId);
    await this.assertEventSyncFits(sportLeague, updates);
    await this.assertProfilesExist(updates);
    if (updates.bracketAdvancement !== undefined) {
      const sportRow = await this.deps.sports.findById(sportLeague.sportId);
      if (sportRow) this.assertAdvancementFits(sportRow.sport, updates.bracketAdvancement);
      if (updates.bracketAdvancement !== sportLeague.bracketAdvancement) await this.assertNoBracketLoaded(sportLeague);
    }
    const updated = await this.deps.sportLeagues.update(sportLeagueId, {
      name: updates.name,
      isActive: updates.isActive,
      bracketAdvancement: updates.bracketAdvancement,
      syncProviderLeagueId: updates.syncProviderLeagueId,
      autoReleaseDaysBeforeStart: updates.autoReleaseDaysBeforeStart,
      platformTierProfileId: updates.platformTierProfileId,
      platformPricingProfileId: updates.platformPricingProfileId,
    });
    if (updates.platformTierProfileId !== undefined && updates.platformTierProfileId !== sportLeague.platformTierProfileId) {
      this.deps.logger?.info({ sportLeagueId, platformTierProfileId: updates.platformTierProfileId }, 'Set sport league tier profile');
    }
    if (updates.platformPricingProfileId !== undefined && updates.platformPricingProfileId !== sportLeague.platformPricingProfileId) {
      this.deps.logger?.info({ sportLeagueId, platformPricingProfileId: updates.platformPricingProfileId }, 'Set sport league pricing profile');
    }
    if (updates.syncProviderLeagueId !== undefined && updates.syncProviderLeagueId !== (sportLeague.selectedProviderMapping?.providerLeagueId ?? null)) {
      this.deps.logger?.info({ sportLeagueId, syncProviderLeagueId: updates.syncProviderLeagueId }, 'Set sport league event sync');
    }
    if (updates.autoReleaseDaysBeforeStart !== undefined && updates.autoReleaseDaysBeforeStart !== sportLeague.autoReleaseDaysBeforeStart) {
      this.deps.logger?.info({ sportLeagueId, autoReleaseDaysBeforeStart: updates.autoReleaseDaysBeforeStart }, 'Set sport league automatic release window');
    }
    return (await this.summarize([updated]))[0];
  }

  /** A provider league a sport league syncs from must exist, play the league's sport, and be running here. */
  private async assertEventSyncFits(
    sportLeague: SportLeague,
    updates: Pick<SportLeagueUpdate, 'syncProviderLeagueId'>,
  ): Promise<void> {
    const providerLeagueId = updates.syncProviderLeagueId;
    if (providerLeagueId === undefined || providerLeagueId === null) return;
    const found = this.deps.providers.findLeague(providerLeagueId);
    if (found === undefined) {
      throw new SportCatalogError(`Provider league ${providerLeagueId} was not found.`, 'PROVIDER_LEAGUE_NOT_FOUND', 404);
    }
    const sportRow = await this.deps.sports.findById(sportLeague.sportId);
    if (!sportRow || found.league.sport !== sportRow.sport) {
      throw new SportCatalogError(
        `${found.provider.name}'s ${found.league.code} plays ${found.league.sport}, so it cannot sync ${sportLeague.name}'s events.`,
        'PROVIDER_SPORT_MISMATCH',
        422,
      );
    }
    if (!found.provider.isEnabled || !found.league.isEnabled || !this.deps.providers.readsLeague(found.provider.code, found.league.code)) {
      throw new SportCatalogError(
        `${found.provider.name}'s ${found.league.code} is switched off or not running, so it cannot sync ${sportLeague.name}'s events.`,
        'PROVIDER_NOT_FOUND',
        422,
      );
    }
  }

  /**
   * Deletes a sport league nothing uses any more (#1400).
   * 404 SPORT_LEAGUE_NOT_FOUND; 409 SPORT_LEAGUE_IN_USE, naming what still uses it, while it has an
   * event, a contest setup, an event page offer, a league's cup, or a participant (#1853: a participant belongs to one sport league).
   */
  async deleteSportLeague(sportLeagueId: string): Promise<void> {
    const sportLeague = await this.requireSportLeague(sportLeagueId);
    const uses = await this.deps.sportLeagues.deleteUnlessUsed(sportLeagueId);
    if (uses === null) throw sportLeagueNotFound(sportLeagueId);
    const inUse = describeSportLeagueUses(uses);
    if (inUse.length > 0) {
      this.deps.logger?.warn({
        action: 'sportLeagueService.deleteSportLeague.inUse',
        data: { sportLeagueId, ...uses },
      }, 'Refused to delete a sport league that is still in use');
      throw new SportCatalogError(
        `${sportLeague.name} still has ${inUse.join(', ')}, so it cannot be deleted.`,
        'SPORT_LEAGUE_IN_USE',
        409,
      );
    }
    this.deps.logger?.info({ action: 'sportLeagueService.deleteSportLeague.success', data: { sportLeagueId } }, 'Deleted sport league');
  }

  /** 404 PLATFORM_TIER_PROFILE_NOT_FOUND or PLATFORM_PRICING_PROFILE_NOT_FOUND for a named profile that does not exist. */
  private async assertProfilesExist(ids: Partial<SportLeagueProfileIds>): Promise<void> {
    const [platformTierProfile, platformPricingProfile] = await Promise.all([
      ids.platformTierProfileId === undefined ? undefined : this.deps.platformTierProfiles.findById(ids.platformTierProfileId),
      ids.platformPricingProfileId === undefined ? undefined : this.deps.platformPricingProfiles.findById(ids.platformPricingProfileId),
    ]);
    if (platformTierProfile === null) {
      throw new SportCatalogError(`Tier profile ${ids.platformTierProfileId} was not found.`, 'PLATFORM_TIER_PROFILE_NOT_FOUND', 404);
    }
    if (platformPricingProfile === null) {
      throw new SportCatalogError(`Pricing profile ${ids.platformPricingProfileId} was not found.`, 'PLATFORM_PRICING_PROFILE_NOT_FOUND', 404);
    }
  }

  /** A reseeded bracket is a bracket's rule: only a sport played as a bracket takes one. */
  private assertAdvancementFits(sport: Sport, bracketAdvancement: BracketAdvancement | undefined): void {
    if (bracketAdvancement === BracketAdvancement.RESEED_BY_SEED && !sportPlaysMatches(sport)) {
      this.deps.logger?.warn({ sport, bracketAdvancement }, 'Refused a reseeded bracket for a sport not played as a bracket');
      throw new SportCatalogError(
        `A ${getSportDefinition(sport).name.toLowerCase()} sport league plays no bracket, so it cannot reseed one.`,
        'SPORT_LEAGUE_NOT_BRACKET',
        422,
      );
    }
  }

  /** A loaded bracket was drawn for the league's rule; the rule holds until no event has one. */
  private async assertNoBracketLoaded(sportLeague: SportLeague): Promise<void> {
    if (await this.deps.sportEvents.sportLeagueHasLoadedBracket(sportLeague.id)) {
      this.deps.logger?.warn({
        action: 'sportLeagueService.updateSportLeague.bracketAdvancementLocked',
        data: { sportLeagueId: sportLeague.id, bracketAdvancement: sportLeague.bracketAdvancement },
      }, 'Refused a bracket rule change on a sport league with a loaded bracket');
      throw new SportCatalogError(
        `${sportLeague.name} has an event with its bracket loaded, so how its bracket winners advance cannot change.`,
        'SPORT_LEAGUE_BRACKET_ADVANCEMENT_LOCKED',
        409,
      );
    }
  }

  /** The sport league's participants, best rank first. 404 SPORT_LEAGUE_NOT_FOUND for an unknown sport league. */
  async listParticipants(sportLeagueId: string): Promise<Participant[]> {
    await this.requireSportLeague(sportLeagueId);
    return this.deps.participants.findBySportLeague(sportLeagueId);
  }

  async updateRankings(
    sportLeagueId: string,
    rankings: readonly ParticipantRanking[],
  ): Promise<Participant[]> {
    await this.requireSportLeague(sportLeagueId);
    await this.deps.participants.updateRankings(sportLeagueId, rankings);
    return this.deps.participants.findBySportLeague(sportLeagueId);
  }

  /**
   * Dry run — resolves each row to an existing Participant of the sport league
   * (participantId, then externalId, then an exact case-insensitive name),
   * writing nothing. Never creates a Participant from a row.
   */
  async previewRankingUpload(
    sportLeagueId: string,
    rows: RankingUploadRow[],
  ): Promise<RankingUploadPreviewRow[]> {
    await this.requireSportLeague(sportLeagueId);
    // Every row's candidates in one read, then each row matched among them (#1183), as the
    // golf round-score preview matches among the event's field.
    const queries = rows.flatMap((row) => {
      const query = participantMatchQuery(row);
      return query ? [query] : [];
    });
    const candidates = await this.deps.participants.findMatchingAny(sportLeagueId, queries);
    const findCandidates = matchAmong(candidates, await feedIdsOfCandidates(rows, candidates, this.deps.mappings));
    return Promise.all(rows.map(async (row) => {
      const { resolution, participant } = await resolveParticipantRow(row, findCandidates);
      return { row, resolution, participantId: participant?.id ?? null, participantName: participant?.name ?? null };
    }));
  }

  /** Applies a previewed upload. Throws when any row is unresolved — all or nothing. */
  async applyRankingUpload(
    sportLeagueId: string,
    rows: RankingUploadRow[],
  ): Promise<Participant[]> {
    const preview = await this.previewRankingUpload(sportLeagueId, rows);
    const unresolved = preview.filter((row) => row.resolution !== 'MATCHED');
    if (unresolved.length > 0) {
      throw new SportCatalogError(
        `${unresolved.length} upload row(s) could not be resolved to a participant.`,
        'SPORT_LEAGUE_RANKING_UPLOAD_UNRESOLVED_ROWS',
        422,
      );
    }
    await this.deps.participants.updateRankings(sportLeagueId, preview.map((resolved) => ({
      participantId: resolved.participantId as string,
      ranking: resolved.row.ranking ?? null,
    })));
    return this.deps.participants.findBySportLeague(sportLeagueId);
  }

  private async requireSportLeague(sportLeagueId: string): Promise<SportLeague> {
    const sportLeague = await this.deps.sportLeagues.findById(sportLeagueId);
    if (!sportLeague) throw sportLeagueNotFound(sportLeagueId);
    return sportLeague;
  }

  private async summarize(sportLeagues: SportLeague[]): Promise<SportLeagueSummary[]> {
    const ids = sportLeagues.map((sportLeague) => sportLeague.id);
    const [sportRows, participantCounts, eventCounts] = await Promise.all([
      this.deps.sports.findAll(),
      this.deps.participants.countBySportLeagues(ids),
      this.deps.sportEvents.countBySportLeagues(ids),
    ]);
    const sportsById = new Map(sportRows.map((sportRow) => [sportRow.id, sportRow]));
    return sportLeagues.map((sportLeague) => {
      const sportRow = requireSportOf(sportsById, sportLeague);
      return {
        ...sportLeague,
        sport: sportRow.sport,
        sportUrlSegment: sportRow.urlSegment,
        sportDisplayOrder: sportRow.displayOrder,
        participantCount: participantCounts.get(sportLeague.id) ?? 0,
        sportEventCount: eventCounts.get(sportLeague.id) ?? 0,
      };
    });
  }
}

/** A sport league's sport, read from its sport row; every sport league has one (a foreign key). */
function requireSportOf(sportsById: ReadonlyMap<string, SportConfig>, sportLeague: SportLeague): SportConfig {
  const sportRow = sportsById.get(sportLeague.sportId);
  if (sportRow === undefined) {
    throw new SportCatalogError(`No Sport row exists for sport league ${sportLeague.id}.`, 'SPORT_NOT_FOUND', 404);
  }
  return sportRow;
}

function sportLeagueNotFound(sportLeagueId: string): SportCatalogError {
  return new SportCatalogError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
}

/** What a refusal names: "2 events, 1 contest setup". Empty when nothing uses the sport league. */
export function describeSportLeagueUses(uses: SportLeagueUses): string[] {
  const counted = (count: number, one: string, many: string) => (count === 0 ? [] : [`${count} ${count === 1 ? one : many}`]);
  return [
    ...counted(uses.sportEventCount, 'event', 'events'),
    ...counted(uses.contestTemplateCount, 'contest setup', 'contest setups'),
    ...counted(uses.eventPageOfferCount, 'event page offer', 'event page offers'),
    ...counted(uses.cupCount, 'league cup', 'league cups'),
    ...counted(uses.participantCount, 'participant', 'participants'),
  ];
}

/**
 * The one Season a sport league made through the admin API starts with (#2003): `now`'s calendar
 * year in UTC, named for it. Every other Season is added by migration. A stopgap for the browser
 * journeys, which make their own leagues, kept private to this service so nothing else builds a
 * Season from the clock; slice 7 (#2004) deletes it when the journeys move to test slots.
 */
function calendarYearSeason(now: Date): SportLeagueSeasonSpan {
  const championshipYear = now.getUTCFullYear();
  return {
    name: String(championshipYear),
    championshipYear,
    startsAt: new Date(Date.UTC(championshipYear, 0, 1)),
    endsAt: new Date(Date.UTC(championshipYear + 1, 0, 1) - 1),
  };
}
