/**
 * `stubInstance(Class, stubs)` — an instance of a class whose methods the test replaces,
 * for a collaborator typed as a CLASS rather than an interface (#345 Phase 2 PR 3).
 *
 * A literal `{ refresh: jest.fn() }` cannot be typed as `AuthService`: the class has private
 * fields, and TypeScript only accepts a value with those privates as an instance of it. The
 * old idiom cast the literal `as any`, which also let a misspelt or wrongly-shaped stub
 * through. Here `stubs` is `Partial<T>`, so a misspelt key or a hand-written stub with the
 * wrong signature fails to compile, and the result is a real `instanceof T`. A bare
 * `jest.fn()` is still `jest.Mock<any, any>`, though, so `refresh: jest.fn().mockResolvedValue(42)`
 * compiles; use `mockFn<T['method']>(impl)` from `mock-fn.ts` where the value matters.
 *
 *     const authService = stubInstance(AuthService, { refresh: jest.fn() });
 *     createAuthHandlers(authService);
 *
 * The constructor does NOT run: the instance has no dependencies and no private state. A
 * method the test did not stub usually throws, because it reads `undefined` fields, which is
 * the point. The exception is a method that never touches `this`: it silently runs the real
 * code.
 *
 * Prefer typing the double against an interface or `Pick<>` where the constructor takes one
 * (no helper needed), and a `repo-fakes.ts` fake for a repository port.
 */
export function stubInstance<T extends object>(
  ctor: abstract new (...args: never[]) => T,
  stubs: Partial<T>,
): T {
  return Object.assign(Object.create(ctor.prototype as object) as T, stubs);
}
