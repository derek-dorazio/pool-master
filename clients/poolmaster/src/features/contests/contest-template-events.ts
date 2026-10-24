import { SelectionType, eventSportDefinition, isTemplateOfferedOn, sportAllowsSelectionType } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto, SportEventDto } from '@/lib/api';
import { bracketRoundCount, bracketStartRoundOptions, hasSecondChanceRound } from './bracket-start-round';
import { isKnockoutUnderWay } from './contest-readiness';

/**
 * The events a contest of this format can be created on: the contest-ready ones and, for a
 * bracket, a knockout under way with a later round to start a second-chance bracket at (#721).
 * A squares contest closes at its own game's kickoff, so an event under way still offers its
 * games to come (#711): the Super Bowl is the last game of the playoffs.
 */
export function contestEventsFor(events: readonly SportEventDto[], selectionType: SelectionType) {
  // An event offers only its own definition's formats: no bracket on a World Series stat pool (#936).
  return events.filter((event) => sportAllowsSelectionType(eventSportDefinition(event), selectionType)).filter((event) => event.contestEligible
    || (selectionType === SelectionType.BRACKET
      && isKnockoutUnderWay(event)
      && hasSecondChanceRound(bracketRoundCount(event)))
    || (selectionType === SelectionType.SQUARES && isKnockoutUnderWay(event)));
}

/**
 * The rounds a bracket on an event can start at: the first before it starts, a later one once it
 * is under way (#721).
 */
export function bracketStartRoundsOf(event: SportEventDto) {
  return bracketStartRoundOptions(bracketRoundCount(event), String, { isUnderWay: !event.contestEligible })
    .map((option) => option.roundNumber);
}

/**
 * Whether an event can start a contest on these rules (#802): a bracket only at a round the event
 * offers, so a full bracket before the first game and a second chance once it is under way.
 */
export function canEventStartRules(configuration: ContestConfigTemplateDto['configuration'], event: SportEventDto) {
  return configuration.selectionType !== SelectionType.BRACKET
    || bracketStartRoundsOf(event).includes(configuration.startsAtRound);
}

/** The events a contest can be created on from this template (#803), soonest first as given. */
export function contestEventsForTemplate(
  events: readonly SportEventDto[],
  template: Pick<ContestConfigTemplateDto, 'sport' | 'sportLeagueId' | 'eventType' | 'selectionType' | 'configuration'>,
) {
  return contestEventsFor(events, template.selectionType)
    .filter((event) => isTemplateOfferedOn(template, event) && canEventStartRules(template.configuration, event));
}
