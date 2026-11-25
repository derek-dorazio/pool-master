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
  /**
   * Whether the family scores a round a participant did not play against the event's par per
   * round (golf's 80 strokes), so the event's details show and edit that par.
   */
  scoresUnplayedRoundsAgainstPar: boolean;
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
    scoresUnplayedRoundsAgainstPar: true,
  },
  [ScoringFamily.FINISH_POSITION]: {
    resultsLabel: 'Results',
    ResultsPanel: RaceFinishingOrderPanel,
    scoresUnplayedRoundsAgainstPar: false,
  },
  [ScoringFamily.HEAD_TO_HEAD]: {
    resultsLabel: 'Bracket',
    ResultsPanel: null,
    scoresUnplayedRoundsAgainstPar: false,
  },
};

export function getScoringFamilyAdminUi(event: Pick<SportLeagueEvent, 'scoringFamily'>): ScoringFamilyAdminUi {
  return SCORING_FAMILY_ADMIN_UI[event.scoringFamily];
}
