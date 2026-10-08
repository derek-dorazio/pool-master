/**
 * The squads module's error types, in their own file rather than in `service.ts`.
 *
 * `squad-name.ts` throws `SquadOperationError` and `service.ts` imports `squad-name.ts`, so
 * while the class lived in `service.ts` the two files formed a runtime import cycle. Errors
 * depend on nothing in the module, so they are the right half to lift out: everything can
 * import them and they import nothing back.
 */

export class SquadOperationError extends Error {
  code: string;

  constructor(message: string, code = 'SQUAD_OPERATION_INVALID') {
    super(message);
    this.name = 'SquadOperationError';
    this.code = code;
  }
}

export class SquadNotFoundError extends Error {
  readonly code = 'SQUAD_NOT_FOUND';
  readonly statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = 'SquadNotFoundError';
  }
}
