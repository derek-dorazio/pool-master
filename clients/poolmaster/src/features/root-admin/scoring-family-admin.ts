import { ScoringFamily, type SportLeagueEvent } from '@poolmaster/shared/domain';
import type { ComponentType } from 'react';
import type { SportEventDto } from '@/lib/api';
import { GolfRoundScoresPanel } from './golf-round-scores-panel';
import { RaceFinishingOrderPanel } from './race-finishing-order-panel';

/**
 * What a scoring family contributes to an event's Manage pages (plans/racing-sports.md Q9.6).
 * The event, field and tier pages are the same for every sport; how results are entered, and
 * any setting only the family's scoring reads, are the family's.
 */
export interface ScoringFamilyAdminUi {
  /** The event's results page, as its sub-menu and trail name it: "Scores", "Results". */
  resultsLabel: string;
  /**
   * The body of the event's results page on an unsynced event: how an admin enters its results.
   * Null for a family whose results come only from the feed (head to head, #2074).
   */
  ResultsPanel: ComponentType<{ event: SportEventDto }> | null;
}

/**
 * Exhaustive over `ScoringFamily`, so a family added to the shared registry fails the web build
 * until its admin results have an entry here. Reached through the event's sport league's
 * definition, never by comparing sports.
 */
export const SCORING_FAMILY_ADMIN_UI: Readonly<Record<ScoringFamily, ScoringFamilyAdminUi>> = {
  [ScoringFamily.STROKE_PLAY]: {
    resultsLabel: 'Scores',
    ResultsPanel: GolfRoundScoresPanel,
  },
  [ScoringFamily.FINISH_POSITION]: {
    resultsLabel: 'Results',
    ResultsPanel: RaceFinishingOrderPanel,
  },
  [ScoringFamily.HEAD_TO_HEAD]: {
    resultsLabel: 'Bracket',
    ResultsPanel: null,
  },
};

export function getScoringFamilyAdminUi(event: Pick<SportLeagueEvent, 'scoringFamily'>): ScoringFamilyAdminUi {
  return SCORING_FAMILY_ADMIN_UI[event.scoringFamily];
}
