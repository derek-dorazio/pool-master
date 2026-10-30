/**
 * Builds the notification emails (#845) from their Prisma adapters: the clock-driven ones for
 * the lifecycle scheduler's "notifications due" step, and the contest milestone ones for the
 * services that move a contest.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  PrismaContestConfigTemplateRepository,
  PrismaContestConfigurationRepository,
  PrismaContestEntryEventStandingRepository,
  PrismaContestEntryMatchPredictionRepository,
  PrismaContestEntryPickRepository,
  PrismaContestEntryRepository,
  PrismaContestEntryStandingRepository,
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
import { createEventPageService } from '../event-pages/wiring';
import type { EmailService } from '../email';
import { createSportEventParticipantService, createSportEventServices, createSportEventTierService } from '../events/wiring';
import { CommissionerNotices } from './commissioner-notices';
import { ContestExpandedNotices } from './contest-expanded-notices';
import { ContestNotices } from './contest-notices';
import { DraftEventNotices } from './draft-event-notices';
import { EntryReceipts } from './entry-receipts';
import { EntryReminders } from './entry-reminders';
import { LiveStandings } from './live-standings';
import { MemberJoinedNotices } from './member-joined-notices';
import { PlanPreviewNotices } from './plan-preview-notices';
import { LeaguePlanService } from '../plans/league-plan-service';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';

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
    sportLeagues: new PrismaSportLeagueRepository(prisma),
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
  planEntitlements: PlanEntitlementsService;
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
    finalStandings: createContestService(prisma, options.logger, { planEntitlements: options.planEntitlements }),
    ...options,
  });
}

export function createCommissionerNotices(prisma: PrismaClient, options: {
  email: EmailService;
  readConfig: () => EmailConfig;
  appBaseUrl: string;
  logger: FastifyBaseLogger;
}): CommissionerNotices {
  return new CommissionerNotices({
    sportEvents: new PrismaSportEventRepository(prisma),
    contests: new PrismaContestRepository(prisma),
    configurations: new PrismaContestConfigurationRepository(prisma),
    matches: new PrismaSportEventMatchRepository(prisma),
    templates: new PrismaContestConfigTemplateRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    eventPages: createEventPageService(prisma, options.logger),
    standings: new PrismaContestEntryStandingRepository(prisma),
    ...options,
  });
}

export function createContestExpandedNotices(prisma: PrismaClient, options: {
  email: EmailService;
  appBaseUrl: string;
  logger: FastifyBaseLogger;
}): ContestExpandedNotices {
  return new ContestExpandedNotices({
    leagues: new PrismaLeagueRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    ...options,
  });
}

export function createDraftEventNotices(prisma: PrismaClient, options: {
  email: EmailService;
  appBaseUrl: string;
  logger: FastifyBaseLogger;
}): DraftEventNotices {
  return new DraftEventNotices({
    sportEvents: new PrismaSportEventRepository(prisma),
    // Read-only: only release readiness is asked, so its own lifecycle is never used.
    releaseReadiness: createSportEventServices(prisma, options.logger).sportEvents,
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
    leagues: new PrismaLeagueRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    ...options,
  });
}

export function createLiveStandings(prisma: PrismaClient, options: {
  email: EmailService;
  readConfig: () => EmailConfig;
  appBaseUrl: string;
  logger: FastifyBaseLogger;
  planEntitlements: PlanEntitlementsService;
}): LiveStandings {
  return new LiveStandings({
    contests: new PrismaContestRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    eventParticipants: createSportEventParticipantService(prisma, options.logger),
    eventStandings: new PrismaContestEntryEventStandingRepository(prisma),
    leaderboards: createContestService(prisma, options.logger, { planEntitlements: options.planEntitlements }),
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

export function createMemberJoinedNotices(prisma: PrismaClient, options: {
  email: EmailService;
  readConfig: () => EmailConfig;
  appBaseUrl: string;
  logger: FastifyBaseLogger;
}): MemberJoinedNotices {
  return new MemberJoinedNotices({
    memberships: new PrismaLeagueMembershipRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    ...options,
  });
}

export function createPlanPreviewNotices(prisma: PrismaClient, options: {
  email: EmailService;
  readConfig: () => EmailConfig;
  appBaseUrl: string;
  logger: FastifyBaseLogger;
  planEntitlements: PlanEntitlementsService;
}): PlanPreviewNotices {
  const leagues = new PrismaLeagueRepository(prisma);
  return new PlanPreviewNotices({
    leagues,
    plans: new LeaguePlanService({ leagues, planEntitlements: options.planEntitlements, logger: options.logger }),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    ...options,
  });
}
