# PoolMaster — Swift Rules

These rules govern the native iOS client.

## Core Rules

- Use Swift and SwiftUI.
- Prefer the Observation framework (`@Observable`, `@State`, `@Environment`) for state flow.
- Keep business logic out of SwiftUI views.
- Model loading, error, empty, and success states explicitly.

## No Mock Data in Application Code

- Never ship mock data, fake responses, or debug-only sample payloads in app code.
- View models must call real APIs and surface real errors.
- Mock data belongs only in tests and previews.

## API Contract Rules

- Treat the backend OpenAPI/DTO contract as the source of truth.
- Do not hand-maintain duplicate API shapes when generated/shared contract models are available.
- If the backend contract changes, update the app to match the new contract rather than inventing compatibility shims.

## Testing

- Use XCTest/XCUITest for unit and UI coverage.
- Add regression tests for critical user flows and bug fixes.
- Do not keep tests that only preserve obsolete API shapes or removed screens.
