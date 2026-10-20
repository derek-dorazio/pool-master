import { SelectionType, contestTemplateEventTypeOf } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto, SportEventDto } from '@/lib/api';
import { bracketRoundCount, hasSecondChanceRound } from './bracket-start-round';
import { isKnockoutUnderWay } from './contest-readiness';

/**
 * The events a contest of this format can be created on: the contest-ready ones and, for a
 * bracket, a knockout under way with a later round to start a second-chance bracket at (#721).
 * A squares contest closes at its own game's kickoff, so an event under way still offers its
 * games to come (#711): the Super Bowl is the last game of the playoffs.
 */
export function contestEventsFor(events: readonly SportEventDto[], selectionType: SelectionType) {
  return events.filter((event) => event.contestEligible
    || (selectionType === SelectionType.BRACKET
      && isKnockoutUnderWay(event)
      && hasSecondChanceRound(bracketRoundCount(event)))
    || (selectionType === SelectionType.SQUARES && isKnockoutUnderWay(event)));
}

/**
 * Whether a template is offered on an event (#802): its own sport league's or a sport-wide one,
 * for the event's kind of event (a knockout or a week of games) or for any.
 */
export function isTemplateOfferedOn(
  template: Pick<ContestConfigTemplateDto, 'sport' | 'sportLeagueId' | 'eventType'>,
  event: SportEventDto,
) {
  return template.sport === event.sport
    && (template.sportLeagueId === null || template.sportLeagueId === event.sportLeagueId)
    && ((template.eventType ?? null) === null || template.eventType === contestTemplateEventTypeOf(event));
}

/** The events a contest can be created on from this template (#803), soonest first as given. */
export function contestEventsForTemplate(
  events: readonly SportEventDto[],
  template: Pick<ContestConfigTemplateDto, 'sport' | 'sportLeagueId' | 'eventType' | 'selectionType'>,
) {
  return contestEventsFor(events, template.selectionType).filter((event) => isTemplateOfferedOn(template, event));
}
