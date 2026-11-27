import { SelectionType, Sport } from '../enums';
import type { SportDefinition } from './sport-definition';

/**
 * American football (#702, plans/knockout-and-pickem-design.md §3.5): teams playing a knockout
 * bracket, scored by the head-to-head family from the bracket's matches. A regular-season week
 * is its own event of one round whose games form no bracket (#715), for pick'em contests. The NFL is its sport
 * league, and reseeds after Wild Card weekend and again after the Divisional round (its
 * postseason slots' pairing RESEEDED, #722), so the best seed left always hosts.
 *
 * The NFL playoffs are 14 teams in four rounds, seven seeds in each conference with the 1 seed on
 * a bye; a bye counts as a win (#2170). Its tier profile is seven tiers of two (#1844), assigned like any
 * sport's from odds or ranking.
 *
 * NCAA Men's Football is a second sport league (#707). Its College Football Playoff is a fixed
 * bracket of 12 teams in four rounds, the top four seeds on byes into the quarterfinals. It names a tier
 * profile of six tiers of two (`SportLeague.platformTierProfileId`). Every round is named by its slot (#2006).
 */
export const americanFootballSportDefinition: SportDefinition = {
  sport: Sport.FOOTBALL,
  name: 'Football',
  defaultRounds: 4,
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.PICK_EM, SelectionType.BRACKET, SelectionType.SURVIVOR, SelectionType.SQUARES],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  pickEm: { tiePicks: false, againstTheSpread: true },
  // A four-round bracket reads Wild Card, Divisional, Conference Championship, Super Bowl; a
  // shorter one keeps the names counted back from its final.
};
