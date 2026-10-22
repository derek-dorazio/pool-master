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
  PrismaUserRepository,
} from '../../adapters';
import type { EmailService } from '../email';
import { createSportEventTierService } from '../events/wiring';
import { ContestNotices } from './contest-notices';
import { EntryReceipts } from './entry-receipts';
import { EntryReminders } from './entry-reminders';

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
  logger?: FastifyBaseLogger;
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
