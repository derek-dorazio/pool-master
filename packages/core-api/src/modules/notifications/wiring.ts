/**
 * Builds the clock-driven emails (#845) from their Prisma adapters, for the lifecycle
 * scheduler's "notifications due" step.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  PrismaContestConfigurationRepository,
  PrismaContestEntryRepository,
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaSportEventMatchRepository,
  PrismaSportEventRepository,
  PrismaSquadMembershipRepository,
  PrismaUserRepository,
} from '../../adapters';
import type { EmailService } from '../email';
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
    leagues: new PrismaLeagueRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    ...options,
  });
}
