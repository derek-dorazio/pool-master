# Plan 57: Privacy And Account Compliance Deferred

## Purpose

Track privacy/account-compliance capabilities that are explicitly deferred from
the first-pass PoolMaster implementation but may be reconsidered later.

This plan exists so those concepts are not lost, while also making clear that
they should not influence current implementation choices.

## Deferred Concepts

### Privacy / Account Rights

- personal data export requests
- account deletion requests
- downloadable export packaging
- deletion scheduling / cancellation workflows

### Responsible-Gaming / Activity Controls

- self-exclusion
- activity limits
- session reminders
- buyback/exclusion-style account controls

### Moderation / Enforcement

- account enforcement actions
- suspension / ban workflows
- moderation review tooling

### Retention / Compliance Jobs

- retention configuration
- retention cleanup job history
- compliance-driven record lifecycle policies

### Separate Age Verification Workflow

- dedicated age-verification endpoint and workflow

This is deferred because first pass will treat age affirmation as part of
consent capture instead.

## Notes

- none of these concepts should block the backend refactor
- none of them should shape the first-pass schema beyond preserving
  `ConsentRecord`
- if one of these features returns later, it should receive a focused dedicated
  design pass rather than being partially resurrected from old code

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 57-001 | 1 | Record deferred privacy/account-compliance concepts for future review | Done | Captured in this plan |
| 57-002 | 2 | Reopen focused design only if the product later needs one of these capabilities | Pending | Future consideration only |
