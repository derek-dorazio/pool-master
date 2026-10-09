import { ErrorEnvelopeSchema, type ErrorEnvelope } from '@poolmaster/shared/dto';

/**
 * Shared user-facing error-message extraction for SDK / mutation responses.
 */

const DEFAULT_FALLBACK = 'Something went wrong. Please try again.';

/**
 * The one runtime check that a value is the backend's standard error envelope
 * (`{ error: { code, message, details? } }`, `ErrorEnvelopeSchema` in the
 * shared DTOs). Every backend error path sends this shape.
 */
export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return ErrorEnvelopeSchema.safeParse(value).success;
}

export type ExtractErrorMessageOptions = {
  /** Message to show when the error has no usable text. */
  fallback?: string;
  /** Map of backend error codes to user-facing copy (per-feature special cases). */
  codeMessages?: Record<string, string>;
};

/**
 * Pulls a user-facing message off an SDK / mutation error.
 *
 * - `ApiError`: the `codeMessages` entry for its `code`, else the backend's
 *   own message, else `fallback`. Its `.message` is not used when the
 *   backend sent none (see `hasOwnMessage`): that text is the throw site's
 *   diagnostic and must not shadow this call's `fallback`.
 * - Any other `Error`: its `message`, or `fallback` when empty.
 * - `null` / `undefined`: `fallback`.
 */
export function extractErrorMessage(
  error: Error | null | undefined,
  options?: ExtractErrorMessageOptions,
): string {
  const fallback = options?.fallback ?? DEFAULT_FALLBACK;

  if (error instanceof ApiError) {
    const codeMessages = options?.codeMessages;
    if (codeMessages && error.code !== undefined && Object.hasOwn(codeMessages, error.code)) {
      return codeMessages[error.code];
    }
    return error.hasOwnMessage ? error.message : fallback;
  }

  return error?.message || fallback;
}

/**
 * Wraps an SDK error payload as a real `Error` so `throw`ing it gives normal
 * `instanceof Error` and Promise-rejection semantics. A payload that is the
 * backend error envelope contributes its code, message and details; anything
 * else (a proxy's HTML page, an empty body) leaves them unset.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  /**
   * True when the backend envelope carried the message. False means
   * `message` is synthesized from the throw site's `fallback` (or the
   * generic default) -- callers extracting a display message should treat
   * that as absent, not as real backend text. See `extractErrorMessage`.
   */
  readonly hasOwnMessage: boolean;

  constructor(payload: unknown, fallback?: string) {
    const envelope = isErrorEnvelope(payload) ? payload.error : undefined;
    super(envelope?.message ?? fallback ?? DEFAULT_FALLBACK);
    this.name = 'ApiError';
    this.hasOwnMessage = envelope !== undefined;
    this.code = envelope?.code;
    this.details = envelope?.details;
  }
}

/**
 * Throws an SDK response's `error` field as a real `Error`. Generated SDK
 * calls type `response.error` as the error envelope object, not `Error` --
 * `throw response.error` throws a plain object.
 *
 * - Already a real `Error` (e.g. a network failure the client didn't wrap):
 *   re-thrown unchanged.
 * - No payload at all: throws a plain `Error` with `fallback` as its message.
 * - Any other payload: throws `ApiError`, leaving message resolution to
 *   whatever calls `extractErrorMessage` downstream instead of baking this
 *   throw site's diagnostic `fallback` in as if it were the backend's message.
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
