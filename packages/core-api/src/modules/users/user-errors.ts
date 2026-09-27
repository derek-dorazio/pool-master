/**
 * The one error type the `User` operations raise (#202 step 3.3).
 *
 * Carries the wire contract — a stable `code` and an HTTP `statusCode` — so the handler maps
 * it in one arm instead of one `instanceof` per failure. Before this it was
 * `AccountLifecycleError`, declared inside `account/service.ts`, which is the wrong home for
 * an error the admin caller raises too.
 */
export class UserOperationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'UserOperationError';
  }
}
