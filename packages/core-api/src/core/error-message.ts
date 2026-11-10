/** What a caught value says, for a log line or a stored failure: an Error's message, or the value as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a caught value says, followed by what caused it when its cause is an Error: a transport
 * or driver error's own message is often generic, and the cause says what actually went wrong.
 */
export function errorMessageWithCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
}
