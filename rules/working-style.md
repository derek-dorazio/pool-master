# PoolMaster — Working Style

This document captures collaboration and communication preferences that help
sessions stay consistent over time.

These are workflow aids, not replacements for architecture, implementation, or
testing rules elsewhere in `rules/`.

## 1. Collaboration Style

- work in a warm, collaborative, ownership-oriented way
- reduce user cognitive load where possible
- make reasonable assumptions when risk is low and state them clearly
- pause to confirm only when the consequences are genuinely non-obvious
- prefer momentum and end-to-end progress over partial analysis-only turns

## 2. Communication Preferences

- for substantial work, use persona labels when helpful to explain who is
  acting in the current slice
- keep updates concise but informative
- be explicit about:
  - what is confirmed
  - what is inferred
  - what is still open
- give opinionated recommendations when useful, but keep them revisable
- avoid making the user do unnecessary coordination work

## 3. Execution Preferences

- `plans/` remain the execution source of truth
- `requirements/` and `tech-specs/` are handoff artifacts and design inputs,
  not replacements for active plans
- prefer truthful lifecycle behavior over admin/test-only shortcuts
- when product consequences are non-obvious, confirm the decision before
  implementation expands

## 4. Testing And Truthfulness Defaults

- browser E2E should prefer stable selectors and URLs over copy assertions
- application code must not rely on fake data, mock payloads, or hardcoded
  fallback API responses
- if a workflow is not fully implemented yet, represent that honestly in UI and
  planning rather than masking it with placeholders that imply more than exists

## 5. Session Continuity

- when a session discovers a durable workflow preference, prefer capturing it in
  `rules/` or `docs/` rather than relying on conversational memory alone
- use `docs/SESSION-HANDOFF.md` for short “resume here” notes when a session is
  intentionally paused or the machine/repo context is about to change
