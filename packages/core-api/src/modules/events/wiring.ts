/**
 * Builds the event-core services from their Prisma adapters (#236). Route modules and the
 * contest-side modules that read an event's tiers (drafts, contests, contest management)
 * take their services from here, so each service is assembled in one place.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  PrismaLeagueEventRepository,
  PrismaParticipantLeagueAffiliationRepository,
  PrismaParticipantProviderMappingRepository,
  PrismaParticipantRepository,
  PrismaSeasonRepository,
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
} from '../../adapters';
import { GolfScoreService, type GolfScoreServiceDeps } from '../golf/golf-score-service';
import { SeasonService } from '../sport-catalog/season-service';
import { SportLeagueService } from '../sport-catalog/sport-league-service';
import { resolveEventTiming, resolveTimingPolicyForSport } from './operational-timing';
import { SportEventService } from './service';
import { SportEventParticipantService } from './sport-event-participant-service';
import { SportEventRoundService } from './sport-event-round-service';
import { SportEventTierService } from './sport-event-tier-service';

export function createSportEventTierService(prisma: PrismaClient, logger?: FastifyBaseLogger): SportEventTierService {
  return new SportEventTierService({
    tiers: new PrismaSportEventTierRepository(prisma),
    valuations: new PrismaSportEventParticipantValuationRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    logger,
  });
}

export function createGolfScoreService(prisma: PrismaClient, logger?: FastifyBaseLogger, bus?: GolfScoreServiceDeps['bus']): GolfScoreService {
  return new GolfScoreService({
    sportEvents: new PrismaSportEventRepository(prisma),
    rounds: new PrismaSportEventRoundRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    mappings: new PrismaParticipantProviderMappingRepository(prisma),
    golfRounds: new PrismaSportEventParticipantGolfRoundRepository(prisma),
    golfStandings: new PrismaSportEventParticipantGolfStandingRepository(prisma),
    logger,
    bus,
  });
}

export interface SportEventServices {
  sportEvents: SportEventService;
  rounds: SportEventRoundService;
  tiers: SportEventTierService;
  field: SportEventParticipantService;
  golfScores: GolfScoreService;
  sportLeagues: SportLeagueService;
  seasons: SeasonService;
}

export function createSportEventServices(prisma: PrismaClient, logger?: FastifyBaseLogger): SportEventServices {
  const sports = new PrismaSportRepository(prisma);
  const sportLeagues = new PrismaSportLeagueRepository(prisma);
  const seasons = new PrismaSeasonRepository(prisma);
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
      leagueEvents: new PrismaLeagueEventRepository(prisma),
      seasons,
      sportLeagues,
      sports,
      rounds,
      tiers,
      resolveTiming: async (sport, startDate) => resolveEventTiming(
        { sport, startDate, metadata: {} },
        await resolveTimingPolicyForSport(prisma, sport, {}),
      ),
      logger,
    }),
    field: new SportEventParticipantService({
      sportEvents: events,
      field: new PrismaSportEventParticipantRepository(prisma),
      participants,
      seasons,
      affiliations,
      valuations: new PrismaSportEventParticipantValuationRepository(prisma),
      standings: new PrismaSportEventParticipantStandingRepository(prisma),
      participantRounds: new PrismaSportEventParticipantRoundRepository(prisma),
      golfStandings: new PrismaSportEventParticipantGolfStandingRepository(prisma),
      golfRounds: new PrismaSportEventParticipantGolfRoundRepository(prisma),
      logger,
    }),
    golfScores: createGolfScoreService(prisma, logger),
    sportLeagues: new SportLeagueService({ sports, sportLeagues, seasons, affiliations, participants, logger }),
    seasons: new SeasonService({ sportLeagues, seasons, sportEvents: events, logger }),
  };
}
