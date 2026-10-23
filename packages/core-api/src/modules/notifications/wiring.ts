/**
 * Builds the notification emails (#845) from their Prisma adapters: the clock-driven ones for
 * the lifecycle scheduler's "notifications due" step, and the contest milestone ones for the
 * services that move a contest.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  PrismaContestConfigurationRepository,
  PrismaContestEntryEventStandingRepository,
  PrismaContestEntryMatchPredictionRepository,
  PrismaContestEntryPickRepository,
  PrismaContestEntryRepository,
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaSportEventMatchRepository,
  PrismaSportEventRepository,
  PrismaSportLeagueRepository,
  PrismaSquadMembershipRepository,
  PrismaSquaresRepository,
  PrismaStandingsEmailPositionRepository,
  PrismaUserRepository,
} from '../../adapters';
import { createContestService } from '../contests/wiring';
import type { EmailService } from '../email';
import { createSportEventParticipantService, createSportEventTierService } from '../events/wiring';
import { ContestNotices } from './contest-notices';
import { EntryReceipts } from './entry-receipts';
import { EntryReminders } from './entry-reminders';
import { LiveStandings } from './live-standings';

export function createEntryReminders(prisma: PrismaClient, options: {
  email: EmailService;
  readConfig: () => EmailConfig;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}): EntryReminders {
  return new EntryReminders({
    contests: new PrismaContestRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    configurations: new PrismaContestConfigurationRepository(prisma),
    matches: new PrismaSportEventMatchRepository(prisma),
    entries: new PrismaContestEntryRepository(prisma),
    picks: new PrismaContestEntryPickRepository(prisma),
    predictions: new PrismaContestEntryMatchPredictionRepository(prisma),
    tiers: createSportEventTierService(prisma, options.logger),
    squares: new PrismaSquaresRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    ...options,
  });
}

export function createContestNotices(prisma: PrismaClient, options: {
  email: EmailService;
  appBaseUrl: string;
  logger: FastifyBaseLogger;
}): ContestNotices {
  return new ContestNotices({
    contests: new PrismaContestRepository(prisma),
    configurations: new PrismaContestConfigurationRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    matches: new PrismaSportEventMatchRepository(prisma),
    tiers: createSportEventTierService(prisma, options.logger),
    entries: new PrismaContestEntryRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    finalStandings: createContestService(prisma, options.logger),
    ...options,
  });
}

export function createEntryReceipts(prisma: PrismaClient, options: {
  email: EmailService;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}): EntryReceipts {
  return new EntryReceipts({
    contests: new PrismaContestRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    entries: new PrismaContestEntryRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    ...options,
  });
}

export function createLiveStandings(prisma: PrismaClient, options: {
  email: EmailService;
  readConfig: () => EmailConfig;
  appBaseUrl: string;
  logger: FastifyBaseLogger;
}): LiveStandings {
  return new LiveStandings({
    contests: new PrismaContestRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    eventParticipants: createSportEventParticipantService(prisma, options.logger),
    eventStandings: new PrismaContestEntryEventStandingRepository(prisma),
    leaderboards: createContestService(prisma, options.logger),
    matches: new PrismaSportEventMatchRepository(prisma),
    configurations: new PrismaContestConfigurationRepository(prisma),
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    positions: new PrismaStandingsEmailPositionRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    ...options,
  });
}
