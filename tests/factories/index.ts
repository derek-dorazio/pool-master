/**
 * Test data factories — helper functions for creating domain objects in tests.
 *
 * Usage:
 *   import { buildLeague, buildMembership } from '../factories';
 *   const league = buildLeague({ name: 'My League' });
 */

import type {
  Contest,
  League,
  LeagueInvitation,
  LeagueMembership,
  LeagueSettings,
  PayoutConfig,
  User,
} from '@poolmaster/shared/domain/types';
import {
  ContestStatus,
  ContestType,
  InvitationStatus,
  InvitePolicy,
  InviteType,
  LeagueMembershipStatus,
  LeagueRole,
  LeagueVisibility,
  ScoringEngine,
  SelectionType,
  WeekDay,
} from '@poolmaster/shared/domain';

let counter = 0;
function nextId(): string {
  counter += 1;
  return `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`;
}

export function buildUser(overrides: Partial<User> = {}): User {
  const id = nextId();
  return {
    id,
    email: `user-${id}@example.com`,
    displayName: `User ${id}`,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function buildLeague(overrides: Partial<League> = {}): League {
  const id = nextId();
  return {
    id,
    leagueCode: `LEAGUE${id.slice(-4)}`,
    name: `League ${id}`,
    createdBy: 'owner-1',
    visibility: LeagueVisibility.PRIVATE,
    maxMembers: 20,
    settings: buildLeagueSettings() as unknown as Record<string, unknown>,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function buildLeagueSettings(overrides: Partial<LeagueSettings> = {}): LeagueSettings {
  return {
    invitePolicy: InvitePolicy.COMMISSIONER_ONLY,
    allowMidSeasonJoin: false,
    requireApproval: false,
    activityFeedEnabled: true,
    weeklyRecapEnabled: false,
    weeklyRecapDay: WeekDay.MONDAY,
    timezone: 'America/New_York',
    currency: 'USD',
    ...overrides,
  };
}

export function buildMembership(overrides: Partial<LeagueMembership> = {}): LeagueMembership {
  return {
    id: nextId(),
    leagueId: 'league-1',
    userId: 'user-1',
    role: LeagueRole.MEMBER,
    status: LeagueMembershipStatus.ACTIVE,
    permissions: [],
    joinedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function buildInvitation(overrides: Partial<LeagueInvitation> = {}): LeagueInvitation {
  return {
    id: nextId(),
    leagueId: 'league-1',
    email: 'invitee@example.com',
    inviteCode: `code-${nextId()}`,
    inviteType: InviteType.EMAIL,
    status: InvitationStatus.PENDING,
    maxUses: 1,
    currentUses: 0,
    invitedBy: 'owner-1',
    expiresAt: new Date('2026-02-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function buildContest(overrides: Partial<Contest> = {}): Contest {
  return {
    id: nextId(),
    leagueId: 'league-1',
    sportEventId: undefined,
    name: 'Masters Pool 2026',
    status: ContestStatus.DRAFT,
    contestType: ContestType.SINGLE_EVENT,
    selectionType: SelectionType.SNAKE_DRAFT,
    scoringEngine: ScoringEngine.STROKE_PLAY,
    isExclusive: false,
    scoringStopsOnElimination: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function buildPayoutConfig(overrides: Partial<PayoutConfig> = {}): PayoutConfig {
  return {
    entryFee: 5000,
    prizePool: 50000,
    payoutStructure: [
      { rank: 1, percentage: 60 },
      { rank: 2, percentage: 25 },
      { rank: 3, percentage: 15 },
    ],
    intermediatePrizes: [],
    ...overrides,
  };
}
