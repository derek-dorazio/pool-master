import {
  CONTEST_BRACKET_SINGLE_EVENT,
  CONTEST_BUDGET_UNFILLABLE,
  CONTEST_DRAW_FIELD_OUT_OF_RANGE,
  CONTEST_EVENT_NOT_A_BRACKET,
  CONTEST_EVENT_NOT_PRICED,
} from '@poolmaster/shared/dto';
import type { ErrorCodeMessages } from '@/lib/errors';

/**
 * Copy for the refusals Create contest, a settings save and "Open to league" can meet (#117,
 * #93), so all three say the same thing. The codes are the contract; the server's own sentences
 * are a fallback for anything not listed.
 */
export const CONTEST_RELEASE_CODE_MESSAGES: ErrorCodeMessages = {
  CONTEST_NOT_DRAFT: 'This contest is already open to the league.',
  CONTEST_EVENT_ALREADY_STARTED:
    'This contest’s event has already started, so it can no longer be opened. Delete the draft instead.',
  CONTEST_CONFIGURATION_LOCKED:
    'This contest is open to the league, so its settings are locked.',
  [CONTEST_EVENT_NOT_PRICED]: 'This event’s field has no prices yet, so it cannot hold a budget contest.',
  [CONTEST_BUDGET_UNFILLABLE]:
    'Even the cheapest picks for every place cost more than the salary cap, so nobody could enter. Pick fewer per entry.',
  [CONTEST_DRAW_FIELD_OUT_OF_RANGE]:
    'More scores count than the draw deals each entry. Lower Scores that count, or deal more per entry.',
  [CONTEST_BRACKET_SINGLE_EVENT]: 'A bracket contest covers one tournament, so it can’t take another event.',
  [CONTEST_EVENT_NOT_A_BRACKET]:
    'This event’s games can’t be filled in as a bracket yet: every team of the round the bracket starts at must be set, and every game must lead to one final.',
};
