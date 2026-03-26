/**
 * Test data factories — helper functions for creating domain objects in tests.
 *
 * Usage:
 *   import { buildLeague, buildMembership } from '../factories';
 *   const league = buildLeague({ name: 'My League' });
 */

import type {
  League,
  LeagueInvitation,
  LeagueMembership,
  LeagueSettings,
  User,
} from '@poolmaster/shared/domain/types';
import {
  InvitationStatus,
  InvitePolicy,
  InviteType,
  LeagueRole,
  LeagueVisibility,
  WeekDay,
} from '@poolmaster/shared/domain/enums';

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
    tenantId: 'tenant-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function buildLeague(overrides: Partial<League> = {}): League {
  const id = nextId();
  return {
    id,
    tenantId: 'tenant-1',
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
    role: LeagueRole.MANAGER,
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
