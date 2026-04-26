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
