/**
 * Repository port interfaces.
 *
 * These interfaces define the contract that all database adapters must implement.
 * Services depend on these ports — never on concrete adapter implementations.
 */

import type {
  Contest,
  DraftPick,
  DraftSession,
  League,
  LeagueMembership,
  Team,
  TeamRoster,
  Tenant,
  User,
} from '../domain';

export interface TenantRepository {
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  create(tenant: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tenant>;
  update(id: string, updates: Partial<Tenant>): Promise<Tenant>;
}

export interface UserRepository {
  findById(id: string, tenantId: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByTenant(tenantId: string): Promise<User[]>;
  create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  update(id: string, updates: Partial<User>): Promise<User>;
  delete(id: string): Promise<void>;
}

export interface LeagueRepository {
  findById(id: string, tenantId: string): Promise<League | null>;
  findByTenant(tenantId: string): Promise<League[]>;
  create(league: Omit<League, 'id' | 'createdAt' | 'updatedAt'>): Promise<League>;
  update(id: string, updates: Partial<League>): Promise<League>;
  delete(id: string): Promise<void>;
}

export interface LeagueMembershipRepository {
  findByLeague(leagueId: string): Promise<LeagueMembership[]>;
  findByUser(userId: string): Promise<LeagueMembership[]>;
  create(membership: Omit<LeagueMembership, 'id' | 'createdAt' | 'updatedAt'>): Promise<LeagueMembership>;
  update(id: string, updates: Partial<LeagueMembership>): Promise<LeagueMembership>;
  delete(id: string): Promise<void>;
}

export interface ContestRepository {
  findById(id: string, tenantId: string): Promise<Contest | null>;
  findByLeague(leagueId: string): Promise<Contest[]>;
  create(contest: Omit<Contest, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contest>;
  update(id: string, updates: Partial<Contest>): Promise<Contest>;
  delete(id: string): Promise<void>;
}

export interface TeamRepository {
  findById(id: string): Promise<Team | null>;
  findByContest(contestId: string): Promise<Team[]>;
  create(team: Omit<Team, 'id' | 'createdAt' | 'updatedAt'>): Promise<Team>;
  getRoster(teamId: string): Promise<TeamRoster[]>;
  addToRoster(entry: Omit<TeamRoster, 'id' | 'createdAt' | 'updatedAt'>): Promise<TeamRoster>;
}

export interface DraftSessionRepository {
  findById(id: string): Promise<DraftSession | null>;
  findByContest(contestId: string): Promise<DraftSession | null>;
  create(session: Omit<DraftSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<DraftSession>;
  update(id: string, updates: Partial<DraftSession>): Promise<DraftSession>;
  getPicks(sessionId: string): Promise<DraftPick[]>;
  addPick(pick: Omit<DraftPick, 'id' | 'createdAt' | 'updatedAt'>): Promise<DraftPick>;
}
