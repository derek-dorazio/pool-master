/**
 * Shared user-facing error-message extraction for SDK / mutation responses.
 *
 * Replaces the per-feature `extractErrorMessage` copies that had drifted out of
 * sync (auth-home-page.tsx, league-detail-page.tsx, my-team-page.tsx).
 * pool-master-dxd.17 closes when the inline copies are replaced with this.
 */

const DEFAULT_FALLBACK = 'Something went wrong. Please try again.';

export type ExtractErrorMessageOptions = {
  /** Message to show when the error has no usable text. */
  fallback?: string;
  /** Map of backend error codes to user-facing copy (per-feature special cases). */
  codeMessages?: Record<string, string>;
};

/**
 * Pulls a user-facing message off an SDK / mutation error.
 *
 * Order of precedence:
 *   1. `codeMessages` lookup against `error.code` or `error.error.code`.
 *   2. `error.error.message` (typical hey-api error envelope).
 *   3. `error.message` (typical native Error or thrown literal).
 *   4. `fallback` (or DEFAULT_FALLBACK if none provided).
 */
export function extractErrorMessage(
  error: unknown,
  options?: ExtractErrorMessageOptions,
): string {
  const fallback = options?.fallback ?? DEFAULT_FALLBACK;

  // ApiError is handled separately rather than duck-typed like a plain
  // envelope below: its own `.message` is a synthesized string (see
  // `hasOwnMessage`) whenever the backend envelope didn't carry one, and
  // that synthesized text must not shadow this call's own `fallback` --
  // e.g. an unmapped error code should still resolve to the caller's
  // generic copy, not to whatever diagnostic text the original `throw`
  // site happened to pass.
  if (error instanceof ApiError) {
    if (options?.codeMessages && error.code && error.code in options.codeMessages) {
      return options.codeMessages[error.code];
    }
    return error.hasOwnMessage ? error.message : fallback;
  }

  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const candidate = error as {
    code?: unknown;
    error?: { code?: unknown; message?: unknown };
    message?: unknown;
  };

  if (options?.codeMessages) {
    const code = typeof candidate.code === 'string'
      ? candidate.code
      : typeof candidate.error?.code === 'string'
        ? candidate.error.code
        : null;
    if (code && code in options.codeMessages) {
      return options.codeMessages[code];
    }
  }

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return fallback;
}

/**
 * Wraps an SDK error envelope (`{ error: { code, message, details } }`) as a
 * real `Error` so `throw`ing it gives normal `instanceof Error` and
 * Promise-rejection semantics. Re-wraps rather than passing the envelope
 * through unchanged -- see `throwApiError`.
 */
export class ApiError extends Error {
  /**
   * The original envelope's nested `error` object, verbatim -- preserved so
   * feature code that duck-types `err.error.code` / `.message` / `.details`
   * directly off a caught error (instead of calling `extractErrorMessage`)
   * keeps working exactly as it did when the raw envelope was thrown.
   */
  readonly error?: { code?: unknown; message?: unknown; details?: unknown };
  readonly code?: string;
  readonly details?: unknown;
  /**
   * True when the backend envelope itself carried a message. False means
   * `message` is synthesized from the throw site's `fallback` (or the
   * generic default) -- callers extracting a display message should treat
   * that as absent, not as real backend text. See `extractErrorMessage`.
   */
  readonly hasOwnMessage: boolean;

  constructor(payload: unknown, fallback?: string) {
    const envelope = payload && typeof payload === 'object'
      ? payload as {
        code?: unknown;
        message?: unknown;
        error?: { code?: unknown; message?: unknown; details?: unknown };
      }
      : undefined;
    const ownMessage = typeof envelope?.error?.message === 'string'
      ? envelope.error.message
      : typeof envelope?.message === 'string'
        ? envelope.message
        : undefined;

    super(ownMessage ?? fallback ?? DEFAULT_FALLBACK);
    this.name = 'ApiError';
    this.hasOwnMessage = ownMessage !== undefined;
    this.error = envelope?.error;
    this.code = typeof envelope?.error?.code === 'string'
      ? envelope.error.code
      : typeof envelope?.code === 'string'
        ? envelope.code
        : undefined;
    this.details = envelope?.error?.details;
  }
}

/**
 * Throws an SDK response's `error` field as a real `Error`. Generated SDK
 * calls type `response.error` as the error envelope object, not `Error` --
 * `throw response.error` throws a plain object.
 *
 * - Already a real `Error` (e.g. a network failure the client didn't wrap):
 *   re-thrown unchanged.
 * - No payload at all (the `??` branch in the pre-migration `throw
 *   response.error ?? new Error(fallback)` pattern): throws a plain `Error`
 *   with `fallback` as its message, same as that pattern did.
 * - A payload present but message-less: throws `ApiError` and leaves message
 *   resolution to whatever calls `extractErrorMessage` downstream, instead
 *   of baking this throw site's diagnostic `fallback` in as if it were the
 *   backend's message.
 */
export function throwApiError(payload: unknown, fallback?: string): never {
  if (payload instanceof Error) {
    throw payload;
  }
  if (!payload) {
    throw new Error(fallback ?? DEFAULT_FALLBACK);
  }
  throw new ApiError(payload, fallback);
}
