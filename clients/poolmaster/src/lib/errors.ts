import {
  displayString,
  hasDisplayString,
  type DisplayStringKey,
  type DisplayStringValues,
  type ErrorContext,
} from '@poolmaster/shared/display-strings';
import { z } from 'zod';
import { ErrorEnvelopeSchema, isApiErrorCode, type ApiErrorCode, type ErrorEnvelope } from '@poolmaster/shared/dto';

/**
 * Shared user-facing error-message extraction for SDK / mutation responses. The words for an API
 * error code come from the display strings (`rules/ux-rules.md` §16 *Display Strings*); the
 * backend's own message is for logs and never shown.
 */

/** The generic sentence: the display string of `INTERNAL_ERROR`. */
const DEFAULT_FALLBACK = displayString('error.INTERNAL_ERROR');

/**
 * The one runtime check that a value is the backend's standard error envelope
 * (`{ error: { code, message, details? } }`, `ErrorEnvelopeSchema` in the
 * shared DTOs). Every backend error path sends this shape.
 */
export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return ErrorEnvelopeSchema.safeParse(value).success;
}

/**
 * Whether an error carries a particular API error code: an `ApiError`, or a raw SDK error
 * payload that is the backend envelope. The code is typed by the API's own list, so a check
 * for a code the API no longer sends fails typecheck instead of silently never matching.
 */
export function hasErrorCode(error: unknown, code: ApiErrorCode): boolean {
  if (error instanceof ApiError) {
    return error.code === code;
  }
  return isErrorEnvelope(error) && error.error.code === code;
}

export type ExtractErrorMessageOptions = {
  /** Message to show when the error carries no API error code. */
  fallback?: string;
  /**
   * The screen's own wording of some codes (`errorContext` in the display strings), tried in
   * order before the code's own message: `'pickEm'`, or `['contestEvents', 'contestSetup']`.
   */
  context?: ErrorContext | readonly ErrorContext[];
  /** The words a context's placeholders take, such as the sport's `{{match}}`. */
  values?: DisplayStringValues;
};

/**
 * The words for an API error code: the first of the screen's contexts with wording for it
 * (`error.<CODE>.<context>`), else the code's own message (`error.<CODE>`).
 */
export function errorCodeMessage(
  code: ApiErrorCode,
  options?: Pick<ExtractErrorMessageOptions, 'context' | 'values'>,
): string {
  const contexts: readonly ErrorContext[] = options?.context === undefined
    ? []
    : typeof options.context === 'string' ? [options.context] : options.context;
  const contextKey = contexts
    .map((context) => `error.${code}.${context}`)
    .find((key) => hasDisplayString(key));
  // The key is chosen at run time, so its placeholders cannot be checked here; each screen's
  // values are typed where it builds them.
  const lookUp = displayString as (key: DisplayStringKey, values?: DisplayStringValues) => string;
  return lookUp((contextKey ?? `error.${code}`) as DisplayStringKey, options?.values);
}

/**
 * Pulls a user-facing message off an SDK / mutation error.
 *
 * - `ApiError` with a code the API lists: `errorCodeMessage` — the screen's context wording,
 *   else the code's display string. The backend's message is never shown.
 * - `ApiError` with no code, or one this build does not know: `fallback`.
 * - Any other `Error` (a network failure, a client-side check): its `message`, or `fallback`
 *   when empty.
 * - `null` / `undefined`: `fallback`.
 *
 * `fallback` defaults to the generic "Something went wrong" sentence.
 */
export function extractErrorMessage(
  error: Error | null | undefined,
  options?: ExtractErrorMessageOptions,
): string {
  const fallback = options?.fallback ?? DEFAULT_FALLBACK;

  if (error instanceof ApiError) {
    return error.code !== undefined && isApiErrorCode(error.code) ? errorCodeMessage(error.code, options) : fallback;
  }

  return error?.message || fallback;
}

/**
 * Wraps an SDK error payload as a real `Error` so `throw`ing it gives normal
 * `instanceof Error` and Promise-rejection semantics. A payload that is the
 * backend error envelope contributes its code, message and details; anything
 * else (a proxy's HTML page, an empty body) leaves them unset. The message is
 * for logs: screens show `extractErrorMessage`, which reads the code.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;

  constructor(payload: unknown, fallback?: string) {
    const envelope = isErrorEnvelope(payload) ? payload.error : undefined;
    super(envelope?.message ?? fallback ?? DEFAULT_FALLBACK);
    this.name = 'ApiError';
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

const IssuePathsSchema = z.array(z.object({ path: z.array(z.union([z.string(), z.number()])) }));

/**
 * Where each of a refusal's validation issues points: the paths of the Zod issues a 400 carries
 * as its envelope's `details` (a SETTINGS_INVALID save, say). None for any other error.
 */
export function errorIssuePaths(error: unknown): (string | number)[][] {
  const details = error instanceof ApiError ? error.details : isErrorEnvelope(error) ? error.error.details : undefined;
  const parsed = IssuePathsSchema.safeParse(details);
  return parsed.success ? parsed.data.map(({ path }) => path) : [];
}
