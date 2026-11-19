/**
 * The root admin's Customers page (#1882): every league and every user on the platform, each one
 * row of a grid that loads them all and filters on the client. Read whole, never paged.
 */
import type { LeaguePlan } from './enums';

/** The commissioner a Customers league row names as its owner. */
export interface CustomerLeagueOwner {
  userId: string;
  firstName: string;
  lastName: string;
}

/** One league on the Customers › Leagues grid. */
export interface CustomerLeague {
  id: string;
  leagueCode: string;
  name: string;
  isActive: boolean;
  plan: LeaguePlan;
  /**
   * The league's longest-serving active commissioner: its creator, unless they stepped down.
   * Null when the league has no active commissioner.
   */
  owner: CustomerLeagueOwner | null;
  /** Active members. */
  memberCount: number;
  /** Open and live contests; drafts are not counted. */
  activeContestCount: number;
  /** When the league's gifted plan (the Premium preview) ends, or null once it has ended. */
  previewEndsAt: Date | null;
  createdAt: Date;
}

/** A league a Customers user row belongs to. */
export interface CustomerUserLeague {
  id: string;
  leagueCode: string;
  name: string;
}

/** One user on the Customers › Users grid. */
export interface CustomerUser {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  isRootAdmin: boolean;
  isActive: boolean;
  /** The leagues the user is an active member of, by name. */
  leagues: CustomerUserLeague[];
  /** When the account was created. */
  joinedAt: Date;
  /** When the user last started a session, or null if they have not since it was first recorded. */
  lastSignInAt: Date | null;
}
