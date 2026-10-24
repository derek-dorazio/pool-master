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
  PayoutConfig,
  User,
} from '@poolmaster/shared/domain/types';
import {
  BracketAdvancement,
  CupPointsScale,
  LeaguePlan,
  CupWeight,
  ContestStatus,
  ContestFormat,
  EventEmailDelivery,
  InvitationStatus,
  LeagueIconKey,
  InviteType,
  LeagueMembershipStatus,
  LeagueRole,
  SelectionType,
  type SportLeague,
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
    username: `user-${id}`.toLowerCase(),
    firstName: 'User',
    lastName: id,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function buildSportLeague(overrides: Partial<SportLeague> = {}): SportLeague {
  const id = nextId();
  return {
    id,
    sportId: 'sport-golf',
    name: `Sport League ${id}`,
    displayName: null,
    displayOrder: null,
    matchKeyword: null,
    currentEventYear: null,
    isActive: true,
    bracketAdvancement: BracketAdvancement.FIXED,
    roundNames: [],
    tierCount: null,
    matchPeriodLayout: null,
    squaresFromRound: null,
    noun: null,
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
    cupName: `League ${id} Cup`,
    cupPointsScale: CupPointsScale.STANDARD,
    cupCustomPoints: [],
    hallOfLameVisible: true,
    plan: LeaguePlan.PLATINUM,
    mutedSportLeagueIds: [],
    eventEmailDelivery: EventEmailDelivery.PER_EVENT,
    isActive: true,
    iconKey: LeagueIconKey.TROPHY,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
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
    sportEventIds: [],
    name: 'Masters Pool 2026',
    seasonYear: 2026,
    cupWeight: CupWeight.NORMAL,
    status: ContestStatus.DRAFT,
    contestFormat: ContestFormat.ROSTER,
    selectionType: SelectionType.TIERED,
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
