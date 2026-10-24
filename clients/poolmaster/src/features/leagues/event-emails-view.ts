import { PlanFeature, SUPPORTED_SPORTS, getSportDefinition, type Sport } from '@poolmaster/shared/domain';
import type { LeagueDto, SportLeagueDto } from '@/lib/api';
import { hasPlanFeature } from '@/features/plans/plan-features';

/** The emails the league's choice of sport leagues decides (#851): "Coming up soon" and "Ready for contests". */
export const EVENT_EMAIL_FEATURES = [PlanFeature.EMAIL_EVENT_COMING_UP, PlanFeature.EMAIL_EVENT_READY_FOR_CONTESTS] as const;

/** Whether the league's plan sends either upcoming-event email, so choosing sport leagues means something. */
export function hasEventEmails(league: Pick<LeagueDto, 'planEntitlements'>): boolean {
  return EVENT_EMAIL_FEATURES.some((feature) => hasPlanFeature(league, feature));
}

/** Which of the two upcoming-event emails the league's plan sends; each starts on its own plan. */
function eventEmailsInPlan(league: Pick<LeagueDto, 'planEntitlements'>) {
  return {
    comingUp: hasPlanFeature(league, PlanFeature.EMAIL_EVENT_COMING_UP),
    ready: hasPlanFeature(league, PlanFeature.EMAIL_EVENT_READY_FOR_CONTESTS),
  };
}

/** League settings' line on the emails the plan sends, so it never promises one the league won't get. */
export function describeEventEmailsSection(league: Pick<LeagueDto, 'planEntitlements'>): string {
  const { comingUp, ready } = eventEmailsInPlan(league);
  if (comingUp && ready) return 'Emails to commissioners when an event is coming up and when it\'s ready for contests.';
  return comingUp ? 'Emails to commissioners when an event is coming up.' : 'Emails to commissioners when an event is ready for contests.';
}

/** The edit page's line on the emails the plan sends. */
export function describeEventEmailsPage(league: Pick<LeagueDto, 'planEntitlements'>): string {
  const { comingUp, ready } = eventEmailsInPlan(league);
  const sent = comingUp && ready
    ? 'Commissioners get an email about 10 days before an event, and another once it\'s ready for contests.'
    : comingUp
      ? 'Commissioners get an email about 10 days before an event.'
      : 'Commissioners get an email once an event is ready for contests.';
  return `${sent} Choose the sport leagues you want to hear about.`;
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
