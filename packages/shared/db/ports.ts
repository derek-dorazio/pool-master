/**
 * Repository port interfaces.
 *
 * These interfaces define the contract that all database adapters must implement.
 * Services depend on these ports — never on concrete adapter implementations.
 */

import type {
  BracketPrediction,
  Contest,
  ContestEntry,
  ContestParticipantPool,
  ContestPick,
  ContestResult,
  ContestStanding,
  DraftPick,
  DraftSession,
  League,
  LeagueInvitation,
  LeagueMembership,
  Participant,
  RosterPick,
  Season,
  SelectionConfig,
  SportConfig,
  Tenant,
  User,
} from '../domain';

// --- Tenant & Identity ---

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

// --- League ---

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
  findByLeagueAndUser(leagueId: string, userId: string): Promise<LeagueMembership | null>;
  create(membership: Omit<LeagueMembership, 'id' | 'createdAt' | 'updatedAt'>): Promise<LeagueMembership>;
  update(id: string, updates: Partial<LeagueMembership>): Promise<LeagueMembership>;
  delete(id: string): Promise<void>;
}

export interface LeagueInvitationRepository {
  findById(id: string): Promise<LeagueInvitation | null>;
  findByLeague(leagueId: string): Promise<LeagueInvitation[]>;
  findByCode(inviteCode: string): Promise<LeagueInvitation | null>;
  findByEmail(leagueId: string, email: string): Promise<LeagueInvitation | null>;
  create(invitation: Omit<LeagueInvitation, 'id' | 'createdAt' | 'updatedAt'>): Promise<LeagueInvitation>;
  update(id: string, updates: Partial<LeagueInvitation>): Promise<LeagueInvitation>;
  delete(id: string): Promise<void>;
}

// --- Sport & Participant ---

export interface SportRepository {
  findById(id: string): Promise<SportConfig | null>;
  findAll(): Promise<SportConfig[]>;
  create(sport: Omit<SportConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<SportConfig>;
}

export interface SeasonRepository {
  findById(id: string): Promise<Season | null>;
  findBySport(sportId: string): Promise<Season[]>;
  create(season: Omit<Season, 'id' | 'createdAt' | 'updatedAt'>): Promise<Season>;
}

export interface ParticipantRepository {
  findById(id: string): Promise<Participant | null>;
  findBySport(sportId: string): Promise<Participant[]>;
  search(sportId: string, query: string): Promise<Participant[]>;
  create(participant: Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>): Promise<Participant>;
  update(id: string, updates: Partial<Participant>): Promise<Participant>;
}

// --- Contest ---

export interface ContestRepository {
  findById(id: string, tenantId: string): Promise<Contest | null>;
  findByLeague(leagueId: string): Promise<Contest[]>;
  create(contest: Omit<Contest, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contest>;
  update(id: string, updates: Partial<Contest>): Promise<Contest>;
  delete(id: string): Promise<void>;
}

export interface SelectionConfigRepository {
  findByContest(contestId: string): Promise<SelectionConfig | null>;
  create(config: Omit<SelectionConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<SelectionConfig>;
  update(id: string, updates: Partial<SelectionConfig>): Promise<SelectionConfig>;
}

export interface ContestParticipantPoolRepository {
  findByContest(contestId: string): Promise<ContestParticipantPool[]>;
  create(entry: Omit<ContestParticipantPool, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContestParticipantPool>;
  update(id: string, updates: Partial<ContestParticipantPool>): Promise<ContestParticipantPool>;
}

// --- Entries & Picks ---

export interface ContestEntryRepository {
  findById(id: string): Promise<ContestEntry | null>;
  findByContest(contestId: string): Promise<ContestEntry[]>;
  findByMember(leagueMembershipId: string): Promise<ContestEntry[]>;
  create(entry: Omit<ContestEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContestEntry>;
  update(id: string, updates: Partial<ContestEntry>): Promise<ContestEntry>;
}

export interface RosterPickRepository {
  findByEntry(entryId: string): Promise<RosterPick[]>;
  create(pick: Omit<RosterPick, 'id' | 'createdAt' | 'updatedAt'>): Promise<RosterPick>;
}

export interface ContestPickRepository {
  findByEntry(entryId: string): Promise<ContestPick[]>;
  findByPeriod(contestId: string, period: number): Promise<ContestPick[]>;
  create(pick: Omit<ContestPick, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContestPick>;
  update(id: string, updates: Partial<ContestPick>): Promise<ContestPick>;
  markCorrect(id: string, isCorrect: boolean): Promise<void>;
}

export interface BracketPredictionRepository {
  findByEntry(entryId: string): Promise<BracketPrediction | null>;
  findByContest(contestId: string): Promise<BracketPrediction[]>;
  create(prediction: Omit<BracketPrediction, 'id' | 'createdAt' | 'updatedAt'>): Promise<BracketPrediction>;
  update(id: string, updates: Partial<BracketPrediction>): Promise<BracketPrediction>;
}

// --- Draft Session (Snake Draft only) ---

export interface DraftSessionRepository {
  findById(id: string): Promise<DraftSession | null>;
  findByContest(contestId: string): Promise<DraftSession | null>;
  create(session: Omit<DraftSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<DraftSession>;
  update(id: string, updates: Partial<DraftSession>): Promise<DraftSession>;
  getPicks(sessionId: string): Promise<DraftPick[]>;
  addPick(pick: Omit<DraftPick, 'id' | 'createdAt' | 'updatedAt'>): Promise<DraftPick>;
}

// --- Standings & Results ---

export interface ContestStandingRepository {
  findByContest(contestId: string): Promise<ContestStanding[]>;
  upsert(standing: Omit<ContestStanding, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContestStanding>;
}

export interface ContestResultRepository {
  findByContest(contestId: string): Promise<ContestResult[]>;
  create(result: Omit<ContestResult, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContestResult>;
}
