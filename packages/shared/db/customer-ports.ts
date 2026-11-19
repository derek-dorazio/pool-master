/**
 * The root admin's Customers page (#1882): every league's and every user's facts, each read in a
 * fixed number of grouped queries however many rows there are.
 */
import type { CustomerUser, LeaguePlan } from '@poolmaster/shared/domain';

/** One league as the Customers read finds it, before its owner and preview are worked out. */
export interface CustomerLeagueRecord {
  id: string;
  leagueCode: string;
  name: string;
  isActive: boolean;
  plan: LeaguePlan;
  /** When the league's gifted plan ends or ended. */
  planRenewsAt: Date;
  createdAt: Date;
}

/** An active commissioner of a league, with when they joined it. */
export interface CustomerLeagueCommissioner {
  leagueId: string;
  userId: string;
  firstName: string;
  lastName: string;
  joinedAt: Date;
}

/** Everything the Customers › Leagues rows are computed from. */
export interface CustomerLeagueFacts {
  leagues: CustomerLeagueRecord[];
  /** Every league's active commissioners. */
  commissioners: CustomerLeagueCommissioner[];
  /** Active members per league id; a league with none is absent. */
  memberCounts: Map<string, number>;
  /** Open and live contests per league id; a league with none is absent. */
  activeContestCounts: Map<string, number>;
}

export interface CustomerReader {
  /** Every league, active or not, with the facts its row needs. */
  readLeagueFacts(): Promise<CustomerLeagueFacts>;
  /** Every user, active or not, each with the leagues they are an active member of. */
  readUsers(): Promise<CustomerUser[]>;
}
