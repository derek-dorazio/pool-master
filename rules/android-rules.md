---
description: Modern Android app development best practices for Kotlin, Jetpack Compose, architecture, testing, performance, security, and release quality.
globs:
  - "**/*.kt"
  - "**/*.kts"
  - "**/AndroidManifest.xml"
alwaysApply: false
---

# Android App Development Rules

You are an expert Android engineer working on a modern production Android app.

## Core Principles

- Prefer **Kotlin-first** Android development.
- Prefer **Jetpack Compose** for new UI unless the codebase is clearly View-based.
- Follow **official Android architecture guidance**:
  - clear separation of concerns
  - **UI layer**, **data layer**, and **domain layer** only when it adds meaningful value
  - **repositories** as the boundary between UI/domain and data sources
  - **single source of truth**
  - **unidirectional data flow**
- Build for **maintainability, testability, performance, accessibility, privacy, and offline resilience**.
- Keep code simple, explicit, and easy to review.

## Tech Stack Defaults

- Language: **Kotlin**
- UI: **Jetpack Compose**
- Architecture: **MVVM or MVI-style UDF**
- Async: **Kotlin coroutines + Flow**
- Dependency Injection: **Hilt**
- Local persistence: **Room** or **DataStore** depending on use case
- Networking: **Retrofit + OkHttp + kotlinx.serialization** or project-standard equivalent
- Navigation: **Navigation Compose**
- Image loading: **Coil**
- Testing:
  - unit tests for business logic
  - UI tests where flows matter
  - integration tests for repositories / persistence / networking boundaries
- Build:
  - Gradle Kotlin DSL preferred
  - version catalogs preferred
  - modularization when complexity justifies it

## Architecture Rules

- Never let composables, activities, or fragments talk directly to Retrofit, Room, DataStore, or platform APIs.
- Put data access behind **repositories**.
- Expose UI state from **ViewModels**.
- UI observes immutable state and emits user actions upward.
- Avoid passing mutable objects through layers.
- Prefer **state models** and **UI event intents/actions** over ad hoc booleans and callbacks.
- Keep business logic out of composables.
- Keep ViewModels free of Android UI references unless required by framework APIs.
- Use a domain layer only when it clearly improves reuse, complexity management, or testability.

## UI / Compose Rules

- Write **small, focused composables**.
- Separate:
  - **screen-level composables** that collect state
  - **content composables** that render pure UI
- Prefer **state hoisting**.
- Pass only the minimum required parameters.
- Use `@Stable` / `@Immutable` only when true and beneficial.
- Avoid unnecessary recomposition:
  - use stable models
  - use `remember` appropriately
  - use `derivedStateOf` only when it actually reduces work
- Do not perform business logic or long-running work inside composables.
- Use `collectAsStateWithLifecycle()` for Flow collection in Compose UI.
- Prefer Material 3 unless the project uses another design system.
- Respect large screens, foldables, tablets, and orientation changes.
- Build accessible UI:
  - meaningful content descriptions
  - proper touch target sizes
  - semantic grouping where useful
  - don’t rely on color alone
- Support dark theme unless product requirements say otherwise.

## State Management Rules

- UI state must be represented as a single screen state model when practical.
- Model loading, success, empty, and error states explicitly.
- Prefer immutable `data class` state.
- One-off UI events should not be mixed carelessly into persistent screen state.
- Prefer explicit event handling methods such as:
  - `onRetryClicked()`
  - `onSearchQueryChanged(query)`
  - `onItemSelected(id)`
- Do not expose mutable state outside a ViewModel.
- Prefer `StateFlow` for observable UI state.

## Coroutines and Flow Rules

- Use **structured concurrency**.
- Launch coroutines in the appropriate scope:
  - `viewModelScope` for ViewModels
  - application or injected scope only when justified
- Make dispatcher usage explicit when doing blocking or CPU-heavy work.
- Do not block the main thread.
- Prefer `Flow` for streams and observable data.
- Prefer `suspend` for one-shot operations.
- Handle cancellation correctly.
- Avoid converting everything into Flow unless it truly represents a stream.
- Keep coroutine context switching close to the work that requires it.

## Dependency Injection Rules

- Use **Hilt** as the default DI framework.
- Constructor injection is preferred.
- Use interfaces only where abstraction is useful, not mechanically everywhere.
- Scope dependencies deliberately.
- Do not use service locators or hidden global singletons.
- Prefer injecting dispatchers, clocks, and other hard-to-test dependencies.
- Make test replacements easy.

## CRITICAL: No Mock Data in Application Code

- **NEVER include mock data, fake data, or hardcoded sample responses in ViewModels, composables, repositories, or any application code.** All application code must call real APIs and real data sources.
- Mock data belongs ONLY in test files (unit tests, integration tests, UI tests).
- If an API endpoint does not exist yet, the repository/ViewModel should call it anyway and surface the error state — composables must handle loading, error, and empty states gracefully.
- **NEVER add `if (BuildConfig.DEBUG) return mockData`** or similar conditional mocking in application code.
- **The presence of mock data in application code is a defect** — remove it and wire to the real API.
- Test doubles (fakes, stubs) are created in test source sets only — never in `main` source sets.

## Data Layer Rules

- Repositories coordinate:
  - network
  - local database
  - cache
  - preferences
  - device/platform data sources
- Define a clear source of truth.
- Prefer local-first or cache-aware strategies when appropriate.
- Map network models to domain/UI models explicitly.
- Do not leak API DTOs into UI.
- Do not leak database entities into UI unless intentionally using them as internal models.
- Handle errors explicitly and consistently.
- Prefer typed results or clearly documented exception behavior.

## Networking Rules

- Use typed API models.
- Configure sensible timeouts.
- Handle:
  - retries only when safe
  - auth expiration
  - offline scenarios
  - server errors
  - serialization failures
- Add logging only in debug builds and never expose secrets.
- Keep interceptors small and purposeful.
- Use HTTPS only.
- Never hardcode secrets, API keys, or tokens in source code.

## Persistence Rules

- Use **Room** for structured relational local data.
- Use **DataStore** instead of SharedPreferences for new work.
- Migrations must be planned and tested.
- Encrypt sensitive data when required.
- Persist only what is necessary.
- Be deliberate about cache invalidation and staleness.

## Android Platform Rules

- Minimize direct framework coupling.
- Request only the permissions that are truly necessary.
- Follow modern background work rules.
- Use **WorkManager** for deferrable guaranteed background work.
- Use foreground services only when justified by platform policy and product need.
- Handle lifecycle correctly.
- Avoid memory leaks:
  - no static references to contexts/views
  - clear listeners where needed
  - respect lifecycle-aware collection
- Support process death restoration where appropriate.

## Performance Rules

- Prioritize startup time, scroll smoothness, and interaction latency.
- Ship **Baseline Profiles** for production apps.
- Use **startup profiles** when appropriate for faster startup optimization.
- Avoid unnecessary object allocations in hot paths.
- Avoid overdraw and deeply nested UI where possible.
- Use paging/streaming for large datasets.
- Don’t do expensive work in composition, layout, or draw phases.
- Measure performance before “optimizing.”
- Prefer macrobenchmarking for meaningful app performance checks.

## Testing Rules

- Every non-trivial feature should have tests.
- Prefer a healthy test pyramid:
  - many unit tests
  - fewer integration tests
  - targeted UI/end-to-end tests
- Test business logic independently of Android framework where possible.
- Use fakes for repositories/data sources where practical.
- Verify error states, empty states, and loading states.
- Add regression tests for fixed bugs.
- Avoid brittle UI tests tied to unstable implementation details.
- Keep tests deterministic and fast.

## Security and Privacy Rules

- Minimize data collection.
- Ask for the least sensitive permission possible.
- Treat all user data as sensitive.
- Never log:
  - tokens
  - passwords
  - PII
  - sensitive payloads
- Store secrets securely.
- Validate deep links and exported components carefully.
- Use secure networking practices.
- Follow Play and Android privacy guidance.
- Prefer privacy by default.

## Build / Project Structure Rules

- Prefer clear package-by-feature or feature-layered organization.
- Modularize only when it improves build speed, ownership, reuse, or boundaries.
- Avoid premature over-modularization.
- Use consistent naming.
- Keep Gradle files tidy and centralized.
- Prefer version catalogs and convention plugins for larger codebases.
- CI should run formatting, lint, unit tests, and critical instrumentation checks.

## Code Style Rules

- Write idiomatic Kotlin.
- Prefer expression clarity over cleverness.
- Keep functions short and focused.
- Use descriptive names.
- Avoid boolean parameter ambiguity.
- Prefer sealed interfaces/classes for constrained state/event models.
- Avoid unnecessary comments; make code self-explanatory.
- Add comments for non-obvious decisions, invariants, and tradeoffs.
- Do not introduce patterns or abstractions without a concrete need.

## Review Heuristics

When generating or editing code, check:

1. Is business logic separated from UI?
2. Is state modeled explicitly and immutably?
3. Are dependencies injected cleanly?
4. Are threading and coroutine rules correct?
5. Is the code testable?
6. Is the API surface minimal and understandable?
7. Is the solution Compose-friendly and lifecycle-aware?
8. Does it avoid Android anti-patterns and hidden coupling?
9. Are privacy, security, and permissions handled conservatively?
10. Is performance considered for startup and hot paths?

## Anti-Patterns to Avoid

- Massive activities/fragments
- Fat composables with networking/business logic inside
- Direct database/network access from UI
- Mutable shared state across layers
- Global singleton abuse
- Launching unmanaged coroutines
- Blocking IO on the main thread
- Overusing inheritance where composition is better
- DTO/entity leakage into UI
- Unstructured error handling
- Hardcoded strings in code instead of resources where user-facing
- Shipping without baseline performance checks
- Requesting broad permissions without clear need

## Output Expectations for Generated Code

When producing Android code:

- Default to **Kotlin + Compose + ViewModel + Hilt + Coroutines + Flow**
- Include only the necessary files and imports
- Keep implementations production-oriented, not tutorial-like
- Make state, events, and side effects explicit
- Prefer lifecycle-aware APIs
- Include tests for non-trivial logic
- Note tradeoffs when multiple valid approaches exist
- Match the existing project style if one is already established