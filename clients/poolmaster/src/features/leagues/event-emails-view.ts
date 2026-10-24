import { PlanFeature, SUPPORTED_SPORTS, getSportDefinition, type Sport } from '@poolmaster/shared/domain';
import type { LeagueDto, SportLeagueDto } from '@/lib/api';
import { hasPlanFeature } from '@/features/plans/plan-features';

/** The emails the league's choice of sport leagues decides (#851): "Coming up soon" and "Ready for contests". */
export const EVENT_EMAIL_FEATURES = [PlanFeature.EMAIL_EVENT_COMING_UP, PlanFeature.EMAIL_EVENT_READY_FOR_CONTESTS] as const;

/** Whether the league's plan sends either upcoming-event email, so choosing sport leagues means something. */
export function hasEventEmails(league: Pick<LeagueDto, 'planEntitlements'>): boolean {
  return EVENT_EMAIL_FEATURES.some((feature) => hasPlanFeature(league, feature));
}

export interface EventEmailSport {
  sport: Sport;
  name: string;
  sportLeagues: { id: string; name: string }[];
}

/**
 * The active sport leagues a league can hear about, in groups by sport in the platform's order,
 * each group's by name. Within its sport's group a sport league goes by its own name.
 */
export function groupEventEmailSportLeagues(sportLeagues: readonly SportLeagueDto[]): EventEmailSport[] {
  return SUPPORTED_SPORTS.flatMap((sport) => {
    const group = sportLeagues
      .filter((sportLeague) => sportLeague.sport === sport && sportLeague.isActive)
      .map((sportLeague) => ({ id: sportLeague.id, name: sportLeague.name }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return group.length ? [{ sport, name: getSportDefinition(sport).name, sportLeagues: group }] : [];
  });
}

/** What League settings says the league hears about: every one, none, or how many of them. */
export function describeEventEmailSportLeagues(sportLeagues: readonly SportLeagueDto[], mutedSportLeagueIds: readonly string[]): string {
  const muted = new Set(mutedSportLeagueIds);
  const active = sportLeagues.filter((sportLeague) => sportLeague.isActive);
  const heard = active.filter((sportLeague) => !muted.has(sportLeague.id)).length;
  if (heard === active.length) {
    return 'Every sport league';
  }
  if (heard === 0) {
    return 'None';
  }
  return `${heard} of ${active.length} sport leagues`;
}
