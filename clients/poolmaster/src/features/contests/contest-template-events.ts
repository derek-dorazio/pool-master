import { ContestOpening, SelectionType, isTemplateOfferedOn } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto, SportEventDto } from '@/lib/api';

/** The API's word on whether a contest of this selection type can start on the event now (#1929). */
function eventOpening(event: SportEventDto, selectionType: SelectionType) {
  return event.contestOpenings.find((row) => row.selectionType === selectionType) ?? null;
}

/**
 * The events a contest of this format can be created on: those the API says it opens on now. For
 * a bracket or squares that includes a knockout under way (#721, #711), and an event offers only
 * its own definition's formats (#936).
 */
export function contestEventsFor(events: readonly SportEventDto[], selectionType: SelectionType) {
  return events.filter((event) => eventOpening(event, selectionType)?.opening === ContestOpening.OPEN);
}

/**
 * The rounds a bracket on an event can start at, as the API gives them: the first before it
 * starts, a later one once it is under way (#721).
 */
export function bracketStartRoundsOf(event: SportEventDto): readonly number[] {
  return eventOpening(event, SelectionType.BRACKET)?.startsAtRounds ?? [];
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
