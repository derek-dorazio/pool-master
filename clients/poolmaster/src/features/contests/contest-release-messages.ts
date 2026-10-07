/**
 * Copy for the refusals "Open to league" and a locked-settings save can meet (#117). The codes
 * are the contract; the server's own sentences are a fallback for anything not listed.
 */
export const CONTEST_RELEASE_CODE_MESSAGES: Record<string, string> = {
  CONTEST_NOT_DRAFT: 'This contest is already open to the league.',
  CONTEST_EVENT_ALREADY_STARTED:
    'This contest’s event has already started, so it can no longer be opened. Delete the draft instead.',
  CONTEST_CONFIGURATION_LOCKED:
    'This contest is open to the league, so its settings are locked.',
};
