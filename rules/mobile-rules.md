# PoolMaster — Mobile Rules

These rules govern the iPhone and Android app. It is **planned, not built**: `clients/mobile`
holds no code yet. The choice of stack, and why, is ADR-0010.

## 1. One App, React Native with Expo

- One React Native app built with Expo serves both iOS and Android, in `clients/mobile`.
  Do not start separate Swift or Kotlin apps.
- TypeScript, held to the same compiler and lint settings as the rest of the repo.
- Drop to native modules only for a device capability Expo cannot reach, and say why in
  the PR.

## 2. Reuse Before Rewriting

- Call the API through the generated hey-api client and the types in `@poolmaster/shared`,
  as the web app does; never hand-write request or response shapes.
- Server state goes through TanStack Query and forms through react-hook-form with zod, by
  the same rules as the web app: `react-ui-rules.md` §3 *API Integration*, §4 *TanStack
  Query*, §5 *State, Effect, Form*.
- Logic both apps need moves into a shared package rather than being copied. Screens and
  styling are per platform: the web app's HTML and Tailwind do not carry over.

## 3. No Mock Data in Application Code

Stated once, for every runtime, in [`architecture-rules.md`](architecture-rules.md) §3
*No Mock Data in Application Code*. Mock data belongs only in tests.

## 4. Testing

The same layers as the web app, per `testing-rules.md`: unit and component tests with Jest
and React Native Testing Library, MSW for request-level mocking. The end-to-end tool is
chosen when the app is started.
