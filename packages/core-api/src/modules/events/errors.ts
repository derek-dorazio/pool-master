/**
 * The one error type for the event-core operations (#236): an event, its rounds, its
 * field, its tiers and valuations. Each carries its contract code and HTTP status, so a
 * handler maps any of them the same way.
 */
export class SportEventError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SportEventError';
  }
}
