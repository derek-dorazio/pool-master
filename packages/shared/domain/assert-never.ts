/**
 * The default branch of a `switch` over a union or an enum. Reaching it is a compile error
 * whenever a member has no case, so a new sport, scoring family or category fails the build
 * instead of falling through silently.
 */
export function assertNever(value: never, what = 'value'): never {
  throw new Error(`Unhandled ${what}: ${String(value)}`);
}
