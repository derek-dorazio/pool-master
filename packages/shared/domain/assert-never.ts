/**
 * The default branch of a `switch` over a union or an enum. Reaching it is a compile error
 * whenever a member has no case, so a new sport, scoring family or category fails the build
 * instead of falling through silently.
 */
export function assertNever(value: never, what = 'value'): never {
  throw new Error(`Unhandled ${what}: ${String(value)}`);
}

/**
 * Compiles only when `T` is `true`. A check written as
 * `export type StatusesMatchEnum = AssertTrue<...>` fails the typecheck when an enum and the
 * list or schema that must match it drift apart. Nothing imports such a check; it is
 * exported only so that neither the compiler nor lint reports it as unused.
 */
export type AssertTrue<T extends true> = T;
