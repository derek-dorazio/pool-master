import { CONTEST_BUDGET_UNFILLABLE, CONTEST_DRAW_FIELD_OUT_OF_RANGE, CONTEST_EVENT_NOT_PRICED } from '@poolmaster/shared/dto';
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
  [CONTEST_EVENT_NOT_PRICED]: 'This event’s golfers have no prices yet, so it cannot hold a budget contest.',
  [CONTEST_BUDGET_UNFILLABLE]:
    'Even the cheapest golfers for every place cost more than the salary cap, so nobody could enter. Pick fewer golfers per entry.',
  [CONTEST_DRAW_FIELD_OUT_OF_RANGE]:
    'More scores count than the draw deals each entry. Lower Scores that count, or deal more golfers per entry.',
};
