/**
 * Which module serves which scoring family (#606). Exhaustive over `ScoringFamily`, so a family
 * added to the enum fails the typecheck until it has a module. Callers reach a module through
 * the event's sport, never by comparing sports.
 */
import { ScoringFamily, getSportDefinition, type Sport } from '@poolmaster/shared/domain';
import type { ScoringFamilyModule } from './scoring-family-module';
import { strokePlayScoringFamily } from './stroke-play';

const MODULE_BY_SCORING_FAMILY: Readonly<Record<ScoringFamily, ScoringFamilyModule>> = {
  [ScoringFamily.STROKE_PLAY]: strokePlayScoringFamily,
};

export function getScoringFamilyModule(family: ScoringFamily): ScoringFamilyModule {
  return MODULE_BY_SCORING_FAMILY[family];
}

/** The module that scores a sport's events, by the sport's definition. */
export function scoringFamilyForSport(sport: Sport): ScoringFamilyModule {
  return getScoringFamilyModule(getSportDefinition(sport).scoringFamily);
}
