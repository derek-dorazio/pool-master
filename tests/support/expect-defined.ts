/**
 * `expectDefined(value)` — returns `value` narrowed to non-null, or fails the test with a
 * clear message when it is `null` or `undefined` (#549).
 *
 * It replaces the non-null assertion `value!`, which `@typescript-eslint/no-non-null-assertion`
 * forbids. `value!` only silences the compiler: when the value is missing, the test fails
 * further on with a `TypeError` about reading a property of `undefined`, far from the cause.
 * This fails at the point the value was expected, and says so:
 *
 *     const guest = expectDefined(field.data).participants.find((e) => e.id === guestId);
 *     expect(expectDefined(guest).ranking).toBeNull();
 */
export function expectDefined<T>(value: T, what = 'value'): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what} to be defined, but it was ${String(value)}`);
  }
  return value;
}
