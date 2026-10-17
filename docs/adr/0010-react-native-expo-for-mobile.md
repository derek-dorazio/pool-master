# ADR 0010: React Native with Expo for the iPhone and Android App

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

PoolMaster will want iPhone and Android apps for the same screens the web app has: leagues,
contests, entries, picks and leaderboards. Nothing is built yet. Until now the rules assumed
two native apps (SwiftUI for iOS, Kotlin and Jetpack Compose for Android), with empty
`clients/ios` and `clients/android` folders reserved for them.

The web app is React and TypeScript. It calls the API through the generated hey-api client
and the types in `@poolmaster/shared`, and builds on TanStack Query, react-hook-form and
zod. The common choices today are React Native (usually with Expo), Flutter, and separate
native apps.

## Decision

**The iPhone and Android app is one React Native app built with Expo, in `clients/mobile`.**

This records the stack only. No mobile app is planned or scheduled.

## Consequences

- The app reuses the generated client, shared types, query patterns and validation the web
  app already has, and is written in the language the team already uses.
- Each feature is built twice (web and mobile) rather than three times (web, iOS, Android).
- Screens are not shared with the web app: web uses HTML and Tailwind, mobile uses native
  views, so the UI layer is written again.
- A device feature Expo cannot reach needs a native module. Poolmaster's screens are forms,
  lists and tables, which need none today.
- `rules/mobile-rules.md` replaces `rules/swift-rules.md` and `rules/android-rules.md`.

## Alternatives considered

- **Separate Swift and Kotlin apps.** Best fit with each platform, but every screen is built
  twice and the API client is generated twice in two more languages, with nothing reused
  from the web app. Worth it only with a developer per platform or deep device features.
- **Flutter.** About as widely used as React Native and polished, but it is Dart, so none of
  the existing TypeScript client, types or logic would carry over.
