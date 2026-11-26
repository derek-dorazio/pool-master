import { ContestOpening, type SelectionType } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto, SportEventDto } from '@/lib/api';

/** The API's word on whether a contest of this selection type can start on the event now (#1929). */
function eventOpening(event: SportEventDto, selectionType: SelectionType) {
  return event.contestOpenings.find((row) => row.selectionType === selectionType) ?? null;
}

/**
 * The events a contest of this format can be created on: those the API says it opens on now. For
 * squares that includes a knockout under way (#711), and an event offers only
 * its own definition's formats (#936).
 */
export function contestEventsFor(events: readonly SportEventDto[], selectionType: SelectionType) {
  return events.filter((event) => eventOpening(event, selectionType)?.opening === ContestOpening.OPEN);
}

/**
 * Whether the template is offered on the event (#2010): the event has a Season slot of a slot
 * definition the template lists, both as the API gives them.
 */
function coversEvent(template: Pick<ContestConfigTemplateDto, 'slots'>, event: SportEventDto): boolean {
  return template.slots.some((slot) => event.slotDefinitionIds.includes(slot.id));
}

/** The events a contest can be created on from this template (#803), soonest first as given. */
export function contestEventsForTemplate(
  events: readonly SportEventDto[],
  template: Pick<ContestConfigTemplateDto, 'slots' | 'selectionType'>,
) {
  return contestEventsFor(events, template.selectionType)
    .filter((event) => coversEvent(template, event));
}
