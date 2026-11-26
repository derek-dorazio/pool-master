/**
 * Builds the event-core services from their Prisma adapters (#236). Route modules and the
 * contest-side modules that read an event's tiers (selections, contests, contest management)
 * take their services from here, so each service is assembled in one place.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  PrismaContestConfigurationRepository,
  PrismaContestEntryMatchPredictionRepository,
  PrismaContestRepository,
  PrismaParticipantProviderMappingRepository,
  PrismaParticipantRepository,
  PrismaPlatformPricingProfileRepository,
  PrismaSportEventParticipantGolfRoundRepository,
  PrismaSportEventParticipantGolfStandingRepository,
  PrismaSportEventRoundMatchGameRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventParticipantRaceResultRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventParticipantValuationRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
  PrismaSportEventTierRepository,
  PrismaSportLeagueRepository,
  PrismaSportRepository,
  PrismaPlatformTierProfileRepository,
} from '../../adapters';
import { GolfScoreService } from '../golf/golf-score-service';
import type { GameScoreWriterDeps } from '../scoring-families/head-to-head/game-score-writer';
import { RaceResultService } from '../scoring-families/finish-position/race-result-service';
import { MatchResultService } from '../scoring-families/head-to-head/match-result-service';
import { eventStoresGolfRoundScores } from '../scoring-families/golf-round-scores';
import { eventStoresRaceResults } from '../scoring-families/race-results';
import { SportLeagueService, type SportDataProviderLookup } from '../sport-catalog/sport-league-service';
import { NO_PROVIDERS } from '../ingestion/provider-lookup';
import { EventLifecycleService, type FinishedSportEventSettlement } from './event-lifecycle-service';
import type { DomainEvents } from '../domain-events';
import { SportEventService } from './service';
import { SportEventBracketService } from './sport-event-bracket-service';
import { ProviderGameSlateService } from './provider-game-slate';
import { ReadCache } from '../../core/read-cache';
import { readEventFieldCacheTtlMs, type EventFieldCache } from './event-field-cache';
import { SportEventParticipantService } from './sport-event-participant-service';
import { EventFieldReader } from './event-field-reader';
import { SportEventRoundService } from './sport-event-round-service';
import { SportEventContestService } from './sport-event-contest-service';
import { PrismaSportEventContestReader } from '../../adapters/prisma-sport-event-contest-reader';
import { PrismaSportLeagueSeasonRepository } from '../../adapters/prisma-sport-league-season-repository';
import { SportEventTierService } from './sport-event-tier-service';

export function createSportEventTierService(prisma: PrismaClient, logger?: FastifyBaseLogger): SportEventTierService {
  return new SportEventTierService({
    sportEvents: new PrismaSportEventRepository(prisma),
    tiers: new PrismaSportEventTierRepository(prisma),
    valuations: new PrismaSportEventParticipantValuationRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    platformTierProfiles: new PrismaPlatformTierProfileRepository(prisma),
    platformPricingProfiles: new PrismaPlatformPricingProfileRepository(prisma),
    logger,
  });
}

export function createGolfScoreService(
  prisma: PrismaClient,
  domainEvents: Pick<DomainEvents, 'collect'>,
  logger?: FastifyBaseLogger,
): GolfScoreService {
  return new GolfScoreService({
    events: new PrismaSportEventRepository(prisma),
    rounds: new PrismaSportEventRoundRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    mappings: new PrismaParticipantProviderMappingRepository(prisma),
    golfRounds: new PrismaSportEventParticipantGolfRoundRepository(prisma),
    golfStandings: new PrismaSportEventParticipantGolfStandingRepository(prisma),
    storesGolfRoundScores: eventStoresGolfRoundScores,
    domainEvents,
    logger,
  });
}

/** The admin finishing order for a finish-position event (#622). */
export function createRaceResultService(
  prisma: PrismaClient,
  domainEvents: Pick<DomainEvents, 'collect'>,
  logger?: FastifyBaseLogger,
): RaceResultService {
  return new RaceResultService({
    events: new PrismaSportEventRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    mappings: new PrismaParticipantProviderMappingRepository(prisma),
    raceResults: new PrismaSportEventParticipantRaceResultRepository(prisma),
    storesRaceResults: eventStoresRaceResults,
    domainEvents,
    logger,
  });
}

/** An event's bracket of matches (#698), for an event whose sport plays one. */
export function createSportEventBracketService(
  prisma: PrismaClient,
  domainEvents: Pick<DomainEvents, 'collect'>,
  logger?: FastifyBaseLogger,
): SportEventBracketService {
  return new SportEventBracketService({
    sportEvents: new PrismaSportEventRepository(prisma),
    rounds: new PrismaSportEventRoundRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    matches: new PrismaSportEventRoundMatchRepository(prisma),
    tiers: new PrismaSportEventTierRepository(prisma),
    valuations: new PrismaSportEventParticipantValuationRepository(prisma),
    predictions: new PrismaContestEntryMatchPredictionRepository(prisma),
    contests: new PrismaContestRepository(prisma),
    domainEvents,
    logger,
  });
}

export interface SportEventServices {
  sportEvents: SportEventService;
  rounds: SportEventRoundService;
  bracket: SportEventBracketService;
  tiers: SportEventTierService;
  field: SportEventParticipantService;
  golfScores: GolfScoreService;
  raceResults: RaceResultService;
  matchResults: MatchResultService;
  sportLeagues: SportLeagueService;
  /** A synced league's event's games from its provider (#1728). */
  providerGames: ProviderGameSlateService;
  /** The customer contests on an event, for the root admin (#1889). */
  contests: SportEventContestService;
}

export function createMatchResultService(
  prisma: PrismaClient,
  domainEvents: Pick<DomainEvents, 'collect'>,
  /** The app's event lifecycle, so a result that passes a contest's cutoff puts it live with its email (#1954). */
  contestActivation: Pick<EventLifecycleService, 'activateContestsPastCutoff'>,
  logger?: FastifyBaseLogger,
): MatchResultService {
  return new MatchResultService({
    sportEvents: new PrismaSportEventRepository(prisma),
    matches: new PrismaSportEventRoundMatchRepository(prisma),
    contestActivation,
    domainEvents,
    logger,
  });
}

/**
 * What a provider's game scores are written with (#1496): the admin's own result path, on the
 * app's own event lifecycle and handler map, so a result starts contests past their cutoff with
 * their "Contest is live" email and settles the squares contests on its game (#1954).
 */
export function createGameScoreWriterDeps(
  prisma: PrismaClient,
  providerId: string,
  domainEvents: Pick<DomainEvents, 'collect'>,
  contestActivation: Pick<EventLifecycleService, 'activateContestsPastCutoff'>,
  logger?: FastifyBaseLogger,
): GameScoreWriterDeps {
  return {
    providerId,
    matches: new PrismaSportEventRoundMatchRepository(prisma),
    games: new PrismaSportEventRoundMatchGameRepository(prisma),
    eventParticipants: new PrismaSportEventParticipantRepository(prisma),
    mappings: new PrismaParticipantProviderMappingRepository(prisma),
    results: createMatchResultService(prisma, domainEvents, contestActivation, logger),
    domainEvents,
    logger,
  };
}

/**
 * The fields this container read lately (#1163), one cache for every field service built here,
 * so every contest on an event shares its field. The events routes and ingestion forget an
 * event's field when they write to it.
 */
export const eventFieldCache: EventFieldCache = new ReadCache(readEventFieldCacheTtlMs(process.env));

/** The event's field as the contest and email readers read it, on the one field cache (#1163). */
export function createEventFieldReader(prisma: PrismaClient): EventFieldReader {
  return new EventFieldReader({
    sportEvents: new PrismaSportEventRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    fieldCache: eventFieldCache,
  });
}

/** The event's field as the event admin screens read and write it, on the same field cache. */
export function createSportEventParticipantService(
  prisma: PrismaClient,
  domainEvents: Pick<DomainEvents, 'collect'>,
  logger?: FastifyBaseLogger,
): SportEventParticipantService {
  return new SportEventParticipantService({
    sportEvents: new PrismaSportEventRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    mappings: new PrismaParticipantProviderMappingRepository(prisma),
    matches: new PrismaSportEventRoundMatchRepository(prisma),
    tiers: new PrismaSportEventTierRepository(prisma),
    valuations: new PrismaSportEventParticipantValuationRepository(prisma),
    fieldCache: eventFieldCache,
    domainEvents,
    logger,
  });
}

/**
 * `lifecycle` is the status-change path the release action and an event edit go through: the
 * app's own, so they run on the same instance as every other transition, with its follow-ups.
 */
export function createSportEventServices(
  prisma: PrismaClient,
  logger: FastifyBaseLogger | undefined,
  lifecycle: EventLifecycleService,
  /** What follows each results, field or game write (#1946): the app's one map, built in index.ts. */
  domainEvents: Pick<DomainEvents, 'collect'>,
  /**
   * The provider leagues a sport league's event sync may name, and which providers run here (ADR
   * 0011, #1997). Pass the app's lookup wherever a sport league is updated; omitted, there are none,
   * so turning a league's sync on is refused.
   */
  providers: SportDataProviderLookup = NO_PROVIDERS,
): SportEventServices {
  const sports = new PrismaSportRepository(prisma);
  const sportLeagues = new PrismaSportLeagueRepository(prisma);
  const events = new PrismaSportEventRepository(prisma);

  const rounds = new SportEventRoundService({ rounds: new PrismaSportEventRoundRepository(prisma), logger });
  const tiers = createSportEventTierService(prisma, logger);
  const bracket = createSportEventBracketService(prisma, domainEvents, logger);
  const sportEventService = new SportEventService({
    sportEvents: events,
    sportLeagues,
    sports,
    seasons: new PrismaSportLeagueSeasonRepository(prisma),
    rounds,
    tiers,
    bracket,
    lifecycle,
    contests: new PrismaContestRepository(prisma),
    domainEvents,
    logger,
  });
  return {
    rounds,
    tiers,
    bracket,
    sportEvents: sportEventService,
    contests: new SportEventContestService({ sportEvents: sportEventService, reader: new PrismaSportEventContestReader(prisma) }),
    field: createSportEventParticipantService(prisma, domainEvents, logger),
    providerGames: new ProviderGameSlateService({
      sportEvents: events,
      matches: new PrismaSportEventRoundMatchRepository(prisma),
      games: new PrismaSportEventRoundMatchGameRepository(prisma),
      field: new PrismaSportEventParticipantRepository(prisma),
      mappings: new PrismaParticipantProviderMappingRepository(prisma),
      bracket,
      rounds,
      logger,
    }),
    golfScores: createGolfScoreService(prisma, domainEvents, logger),
    raceResults: createRaceResultService(prisma, domainEvents, logger),
    matchResults: createMatchResultService(prisma, domainEvents, lifecycle, logger),
    sportLeagues: buildSportLeagueService(prisma, logger, providers),
  };
}

/** The sport league admin's service: its settings, its sync switch and its rankings. */
export function buildSportLeagueService(
  prisma: PrismaClient,
  logger: FastifyBaseLogger | undefined,
  /** The provider leagues a sport league's event sync may name (ADR 0011, #1997). */
  providers: SportDataProviderLookup,
): SportLeagueService {
  return new SportLeagueService({
    sports: new PrismaSportRepository(prisma),
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    seasons: new PrismaSportLeagueSeasonRepository(prisma),
    mappings: new PrismaParticipantProviderMappingRepository(prisma),
    providers,
    platformTierProfiles: new PrismaPlatformTierProfileRepository(prisma),
    platformPricingProfiles: new PrismaPlatformPricingProfileRepository(prisma),
    logger,
  });
}

/**
 * The one place a sport event's status changes, with its contest side effects on ports (#247).
 * Settlement and the template contests a release joins are passed in rather than built here: the
 * contest modules build them from this one.
 */
export function createEventLifecycleService(
  prisma: PrismaClient,
  options: {
    /** What follows a status change or a moved start (#1946): the app's one map, built in index.ts. */
    domainEvents: Pick<DomainEvents, 'collect' | 'collectEach'>;
    logger?: FastifyBaseLogger;
    contestSettlement: FinishedSportEventSettlement;
  },
): EventLifecycleService {
  return new EventLifecycleService(
    {
      contests: new PrismaContestRepository(prisma),
      configurations: new PrismaContestConfigurationRepository(prisma),
      matches: new PrismaSportEventRoundMatchRepository(prisma),
    },
    new PrismaSportEventRepository(prisma),
    options.domainEvents,
    { contestSettlement: options.contestSettlement },
    options.logger,
  );
}
