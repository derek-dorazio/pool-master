/**
 * LeagueService — league creation, retrieval, and settings management.
 */

import type { LeagueMembershipRepository, LeagueRepository } from '@poolmaster/shared/db';
import type {
  League,
  LeagueMembership,
  LeagueSettings,
  LeagueVisibility,
} from '@poolmaster/shared/domain';
import { InvitePolicy, LeagueMembershipStatus, LeagueRole, WeekDay } from '@poolmaster/shared/domain';
import { ALL_COMMISSIONER_PERMISSIONS } from '../../core/permissions';
import { randomUUID } from 'node:crypto';

export interface CreateLeagueInput {
  createdBy: string;
  name: string;
  description?: string;
  visibility: LeagueVisibility;
  maxMembers?: number;
  settings?: Partial<LeagueSettings>;
}

export interface UserLeagueView {
  league: League;
  membership: LeagueMembership;
}

const DEFAULT_LEAGUE_SETTINGS: LeagueSettings = {
  invitePolicy: InvitePolicy.COMMISSIONER_ONLY,
  allowMidSeasonJoin: false,
  requireApproval: false,
  activityFeedEnabled: true,
  weeklyRecapEnabled: false,
  weeklyRecapDay: WeekDay.MONDAY,
  timezone: 'America/New_York',
  currency: 'USD',
};

const DEFAULT_MAX_MEMBERS = 20;

export class LeagueService {
  constructor(
    private readonly leagueRepo: LeagueRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
  ) {}

  /** Creates a new league and adds the creator as a commissioner. */
  async createLeague(input: CreateLeagueInput): Promise<{ league: League; membership: LeagueMembership }> {
    const mergedSettings: LeagueSettings = {
      ...DEFAULT_LEAGUE_SETTINGS,
      ...input.settings,
    };
    const leagueCode = await this.generateLeagueCode(input.name);
    const league = await this.leagueRepo.create({
      leagueCode,
      name: input.name,
      description: input.description,
      createdBy: input.createdBy,
      visibility: input.visibility,
      maxMembers: input.maxMembers ?? DEFAULT_MAX_MEMBERS,
      settings: mergedSettings as unknown as Record<string, unknown>,
    });
    const membership = await this.membershipRepo.create({
      leagueId: league.id,
      userId: input.createdBy,
      role: LeagueRole.COMMISSIONER,
      status: LeagueMembershipStatus.ACTIVE,
      permissions: [...ALL_COMMISSIONER_PERMISSIONS],
      joinedAt: new Date(),
    });
    return { league, membership };
  }

  async findById(leagueId: string): Promise<League | null> {
    return this.leagueRepo.findById(leagueId);
  }

  async findByCode(leagueCode: string): Promise<League | null> {
    return this.leagueRepo.findByCode(leagueCode.toUpperCase());
  }

  async findByUser(userId: string): Promise<UserLeagueView[]> {
    const memberships = await this.membershipRepo.findByUser(userId);
    const leagues = await Promise.all(
      memberships.map((membership) => this.leagueRepo.findById(membership.leagueId)),
    );
    return memberships.flatMap((membership, index) => {
      const league = leagues[index];
      if (!league) {
        return [];
      }

      return [{
        league,
        membership,
      }];
    });
  }

  /** Partially updates the league settings JSONB, merging with existing values. */
  async updateSettings(
    leagueId: string,
    updates: Partial<LeagueSettings>,
  ): Promise<League> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      throw new LeagueNotFoundError(leagueId);
    }
    const currentSettings = league.settings as unknown as LeagueSettings;
    const mergedSettings: LeagueSettings = { ...DEFAULT_LEAGUE_SETTINGS, ...currentSettings, ...updates };
    return this.leagueRepo.update(leagueId, {
      settings: mergedSettings as unknown as Record<string, unknown>,
    });
  }

  /** Returns the league together with its member list. */
  async getLeagueWithMembers(
    leagueId: string,
  ): Promise<{ league: League; members: LeagueMembership[] } | null> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      return null;
    }
    const members = await this.membershipRepo.findByLeague(leagueId);
    return { league, members };
  }

  async getLeagueWithMembersByCode(
    leagueCode: string,
  ): Promise<{ league: League; members: LeagueMembership[] } | null> {
    const league = await this.findByCode(leagueCode);
    if (!league) {
      return null;
    }
    const members = await this.membershipRepo.findByLeague(league.id);
    return { league, members };
  }

  private async generateLeagueCode(name: string): Promise<string> {
    const normalizedBase = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'LEAGUE';
    const firstAttempt = normalizedBase.slice(0, 16);
    if (!(await this.leagueRepo.findByCode(firstAttempt))) {
      return firstAttempt;
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const suffix = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
      const candidate = `${normalizedBase.slice(0, 12)}${suffix}`.slice(0, 16);
      if (!(await this.leagueRepo.findByCode(candidate))) {
        return candidate;
      }
    }

    throw new Error('Unable to generate a unique league code');
  }
}

export class LeagueNotFoundError extends Error {
  constructor(leagueId: string) {
    super(`League not found: ${leagueId}`);
    this.name = 'LeagueNotFoundError';
  }
}
