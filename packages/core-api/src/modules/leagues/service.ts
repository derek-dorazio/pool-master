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

export interface CreateLeagueInput {
  tenantId: string;
  createdBy: string;
  name: string;
  description?: string;
  visibility: LeagueVisibility;
  maxMembers?: number;
  settings?: Partial<LeagueSettings>;
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

  /** Creates a new league and adds the creator as OWNER. */
  async createLeague(input: CreateLeagueInput): Promise<{ league: League; membership: LeagueMembership }> {
    const mergedSettings: LeagueSettings = {
      ...DEFAULT_LEAGUE_SETTINGS,
      ...input.settings,
    };
    const league = await this.leagueRepo.create({
      tenantId: input.tenantId,
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
      role: LeagueRole.OWNER,
      status: LeagueMembershipStatus.ACTIVE,
      permissions: [],
      joinedAt: new Date(),
    });
    return { league, membership };
  }

  async findById(leagueId: string, tenantId: string): Promise<League | null> {
    return this.leagueRepo.findById(leagueId, tenantId);
  }

  async findByUser(userId: string): Promise<League[]> {
    const memberships = await this.membershipRepo.findByUser(userId);
    const leagues = await Promise.all(
      memberships.map((membership) => this.leagueRepo.findById(membership.leagueId, '')),
    );
    return leagues.filter((league): league is League => league !== null);
  }

  async findByTenant(tenantId: string): Promise<League[]> {
    return this.leagueRepo.findByTenant(tenantId);
  }

  /** Partially updates the league settings JSONB, merging with existing values. */
  async updateSettings(
    leagueId: string,
    tenantId: string,
    updates: Partial<LeagueSettings>,
  ): Promise<League> {
    const league = await this.leagueRepo.findById(leagueId, tenantId);
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
    tenantId: string,
  ): Promise<{ league: League; members: LeagueMembership[] } | null> {
    const league = await this.leagueRepo.findById(leagueId, tenantId);
    if (!league) {
      return null;
    }
    const members = await this.membershipRepo.findByLeague(leagueId);
    return { league, members };
  }
}

export class LeagueNotFoundError extends Error {
  constructor(leagueId: string) {
    super(`League not found: ${leagueId}`);
    this.name = 'LeagueNotFoundError';
  }
}
