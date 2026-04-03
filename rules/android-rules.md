# PoolMaster — Android Rules

These rules govern the native Android client.

## Core Rules

- Use Kotlin-first Android development.
- Prefer Jetpack Compose for UI.
- Use MVVM or MVI-style unidirectional data flow.
- Keep composables free of business logic.
- Expose immutable screen state from ViewModels.

## Dependency and Data Rules

- Use repositories as the boundary to network, storage, and platform APIs.
- Use Hilt for dependency injection.
- Use coroutines and Flow deliberately and keep threading explicit.

## No Mock Data in Application Code

- Never ship mock data, fake API responses, or debug-only fallbacks in `main` source sets.
- Repositories and ViewModels must call real APIs and surface real errors.
- Mock data belongs only in test source sets and preview/test scaffolding.

## API Contract Rules

- Treat the backend OpenAPI/DTO contract as the source of truth.
- Do not duplicate endpoint strings and response shapes across the app if a shared/generated contract exists.
- If the contract is wrong, fix the source contract rather than patching callers with local fake models.

## Testing

- Use unit tests for business logic and ViewModels.
- Use Compose/UI tests where flows matter.
- Add regression coverage for contract-sensitive flows.
- Remove tests that only preserve obsolete architecture or deleted UI.
