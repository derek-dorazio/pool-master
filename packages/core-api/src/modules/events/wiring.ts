/**
 * Builds the event-core services from their Prisma adapters (#236). Route modules and the
 * contest-side modules that read an event's tiers (drafts, contests, contest management)
 * take their services from here, so each service is assembled in one place.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  PrismaContestEntryRepository,
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaEventSeriesRepository,
  PrismaParticipantLeagueAffiliationRepository,
  PrismaParticipantProviderMappingRepository,
  PrismaParticipantRepository,
  PrismaSportEventParticipantGolfRoundRepository,
  PrismaSportEventParticipantGolfStandingRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventParticipantRoundRepository,
  PrismaSportEventParticipantStandingRepository,
  PrismaSportEventParticipantValuationRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
  PrismaSportEventTierRepository,
  PrismaSportLeagueRepository,
  PrismaSportRepository,
  PrismaSquadMembershipRepository,
  PrismaUserRepository,
} from '../../adapters';
import type { MailDeliveryProvider } from '../email';
import { GolfScoreService } from '../golf/golf-score-service';
import { SportLeagueService } from '../sport-catalog/sport-league-service';
import { EventLifecycleService, type CompletedSportEventSettlement } from './event-lifecycle-service';
import { SportEventService } from './service';
import { SportEventParticipantService } from './sport-event-participant-service';
import { SportEventRoundService } from './sport-event-round-service';
import { SportEventTierService } from './sport-event-tier-service';

export function createSportEventTierService(prisma: PrismaClient, logger?: FastifyBaseLogger): SportEventTierService {
  return new SportEventTierService({
    sportEvents: new PrismaSportEventRepository(prisma),
    tiers: new PrismaSportEventTierRepository(prisma),
    valuations: new PrismaSportEventParticipantValuationRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    logger,
  });
}

export function createGolfScoreService(prisma: PrismaClient, logger?: FastifyBaseLogger): GolfScoreService {
  return new GolfScoreService({
    events: new PrismaSportEventRepository(prisma),
    rounds: new PrismaSportEventRoundRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    mappings: new PrismaParticipantProviderMappingRepository(prisma),
    golfRounds: new PrismaSportEventParticipantGolfRoundRepository(prisma),
    golfStandings: new PrismaSportEventParticipantGolfStandingRepository(prisma),
    logger,
  });
}

export interface SportEventServices {
  sportEvents: SportEventService;
  rounds: SportEventRoundService;
  tiers: SportEventTierService;
  field: SportEventParticipantService;
  golfScores: GolfScoreService;
  sportLeagues: SportLeagueService;
}

/** The event's field as every reader sees it — the event admin screens and the contest golf reads alike. */
export function createSportEventParticipantService(prisma: PrismaClient, logger?: FastifyBaseLogger): SportEventParticipantService {
  return new SportEventParticipantService({
    sportEvents: new PrismaSportEventRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    affiliations: new PrismaParticipantLeagueAffiliationRepository(prisma),
    valuations: new PrismaSportEventParticipantValuationRepository(prisma),
    standings: new PrismaSportEventParticipantStandingRepository(prisma),
    participantRounds: new PrismaSportEventParticipantRoundRepository(prisma),
    golfStandings: new PrismaSportEventParticipantGolfStandingRepository(prisma),
    golfRounds: new PrismaSportEventParticipantGolfRoundRepository(prisma),
    logger,
  });
}

/**
 * `lifecycle` is the status-change path the release action goes through. Pass the app's own
 * so a release runs on the same instance as every other transition; omitted, one is built
 * without mail or settlement, which a release never needs.
 */
export function createSportEventServices(
  prisma: PrismaClient,
  logger?: FastifyBaseLogger,
  lifecycle: EventLifecycleService = createEventLifecycleService(prisma, { logger }),
): SportEventServices {
  const sports = new PrismaSportRepository(prisma);
  const sportLeagues = new PrismaSportLeagueRepository(prisma);
  const events = new PrismaSportEventRepository(prisma);
  const affiliations = new PrismaParticipantLeagueAffiliationRepository(prisma);
  const participants = new PrismaParticipantRepository(prisma);

  const rounds = new SportEventRoundService({ rounds: new PrismaSportEventRoundRepository(prisma), logger });
  const tiers = createSportEventTierService(prisma, logger);
  return {
    rounds,
    tiers,
    sportEvents: new SportEventService({
      sportEvents: events,
      eventSeries: new PrismaEventSeriesRepository(prisma),
      sportLeagues,
      sports,
      rounds,
      tiers,
      lifecycle,
      logger,
    }),
    field: createSportEventParticipantService(prisma, logger),
    golfScores: createGolfScoreService(prisma, logger),
    sportLeagues: new SportLeagueService({ sports, sportLeagues, sportEvents: events, affiliations, participants, logger }),
  };
}

/**
 * The one place a sport event's status changes, with its contest side effects on ports (#247).
 * Settlement is passed in rather than built here: the contests module builds it from this one.
 */
export function createEventLifecycleService(
  prisma: PrismaClient,
  options: {
    logger?: FastifyBaseLogger;
    mailDelivery?: MailDeliveryProvider;
    appBaseUrl?: string;
    golfContestSettlement?: CompletedSportEventSettlement;
  } = {},
): EventLifecycleService {
  return new EventLifecycleService(
    {
      contests: new PrismaContestRepository(prisma),
      entries: new PrismaContestEntryRepository(prisma),
      leagues: new PrismaLeagueRepository(prisma),
      memberships: new PrismaLeagueMembershipRepository(prisma),
      squadMemberships: new PrismaSquadMembershipRepository(prisma),
      users: new PrismaUserRepository(prisma),
    },
    new PrismaSportEventRepository(prisma),
    options.logger,
    options.mailDelivery,
    options.appBaseUrl,
    options.golfContestSettlement,
  );
}
