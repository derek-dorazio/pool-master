# Plan 55: Privacy And Account Compliance Removal

## Purpose

Remove the current privacy/account-compliance subsystem from the active backend
model and service implementation, keeping only a minimal consent capability for
first pass.

The reviewed product direction does **not** need the current large compliance
surface. Most of it should be removed now and revisited later only if the
product genuinely needs it.

## First-Pass Direction

Retain only:

- `ConsentRecord`

Remove from the active first-pass implementation:

- `DataExportRequest`
- `DeletionRequest`
- `SelfExclusion`
- `AccountEnforcement`
- `RetentionConfig`
- `RetentionJobRun`
- age-verification routes as a separate subsystem
- session-reminder/activity-limit compliance behavior

## Important Clarification

Age affirmation is still needed in first pass, but it should be handled as part
of user consent capture rather than as a separate compliance subsystem.

The UI can ask the user to affirm they are over 13 or over 18, and that
affirmation can be stored as part of `ConsentRecord`.

## What Should Be Removed

### Schema / Model

- `DataExportRequest`
- `DeletionRequest`
- `SelfExclusion`
- `AccountEnforcement`
- `RetentionConfig`
- `RetentionJobRun`

### Service / Routes

- data export request/status routes
- account deletion request/status routes
- self-exclusion routes
- activity-limit/session-reminder routes
- account-enforcement routes
- separate age-verification route

### Product Assumptions To Drop

- gambling-style activity limits
- self-exclusion
- responsible-gaming compliance workflows
- GDPR/export/delete workflows as part of first-pass product scope

## What Stays

- `ConsentRecord`
- consent history if needed
- age affirmation captured as part of consent workflow

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 55-001 | 1 | Remove non-consent compliance models from the target schema and migration plan | Done | Retention and non-consent compliance schema artifacts removed; forward migration added for retained consent age-affirmation fields |
| 55-002 | 1 | Remove compliance routes/services that are out of scope for first pass | Done | Compliance module removed; only minimal account-consent routes remain |
| 55-003 | 1 | Keep only the minimal consent persistence concept | Done | `ConsentRecord` retained with age-affirmation fields exposed through the new account-consent module |
| 55-004 | 2 | Remove or rewrite tests that enforce deleted compliance behavior | Done | Old compliance tests removed; new consent unit/integration coverage added |
| 55-005 | 2 | Update docs/plans so agents do not treat the old compliance subsystem as active guidance | Done | Removal/deferred plans and consent use cases now match the implemented slice |
