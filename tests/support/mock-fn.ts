/**
 * `mockFn<Port['method']>(impl)` — a `jest.fn` whose implementation is typed by the port
 * method it stands in for (#345 Phase 2 PR 2).
 *
 * `jest.fn().mockImplementation(async (id, updates) => ...)` is `jest.Mock<any, any>`: its
 * parameters arrive as `any`, whatever the implementation returns is `any`, and the result
 * is assignable to any port method at all. So an override passed into a `repo-fakes.ts`
 * fake's `Partial<Port>` throws away exactly the type that fake exists to check, and a
 * double that returns the wrong shape — or `T` where the port returns `Promise<T>` —
 * compiles.
 *
 * Naming the method type instead lets the parameters be inferred from the port and checks
 * the return against it:
 *
 *     fakeContestRepo({
 *       update: mockFn<ContestRepository['update']>(async (id, updates) => ({
 *         ...buildContest({ id }),
 *         ...updates,
 *       })),
 *     });
 *
 * The result is still a `jest.Mock`, so `mockResolvedValueOnce`, `toHaveBeenCalledWith`
 * and the rest work as before, now typed against the port.
 *
 * Use `jest.fn().mockResolvedValue(x)` where a fixed value is enough — `x` is already a
 * typed expression — and reach for this when the double computes its result from its
 * arguments. See `rules/testing-rules.md` §1B *Test doubles are typed by the contract they
 * stand in for*.
 */
export function mockFn<F extends (...args: never[]) => unknown>(
  implementation: (...args: Parameters<F>) => ReturnType<F>,
): jest.Mock<ReturnType<F>, Parameters<F>> {
  return jest.fn(implementation);
}
