/**
 * The customer contests run on one sport event (#1889): the root admin's Event page lists every
 * one, across every league, read-only.
 */
import type { ContestStatus } from './enums';

export interface SportEventContest {
  id: string;
  name: string;
  status: ContestStatus;
  /** The customer league that runs it. */
  league: { id: string; name: string };
  /** The contest template it was set up from; null for a contest set up without one. */
  contestTemplate: { id: string; name: string } | null;
  entryCount: number;
  createdAt: Date;
}
