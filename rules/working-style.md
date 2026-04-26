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
- for substantial work, include a short status summary that makes the current
  state explicit
- keep updates concise but informative
- be explicit about:
  - what is confirmed
  - what is inferred
  - what is still open
- give opinionated recommendations when useful, but keep them revisable
- avoid making the user do unnecessary coordination work
- when screenshots, reference visuals, or example flows would materially improve
  product definition or interaction design, ask for them explicitly instead of
  guessing from prose alone
- keep visual requests narrow and specific so the user knows exactly what kind
  of screenshot or example would help

### Status Summary Expectations

When a slice involves planning, refinement, implementation, testing, or git
checkpointing, substantive updates should make the current state easy to scan.

Prefer a short summary using explicit workflow tags such as:

- `Status: Refinement`
- `Status: Plan Updated`
- `Status: Ready for Implementation`
- `Status: Implementing`
- `Status: Implementation Complete`
- `Status: Verifying`
- `Status: Verified`
- `Status: Ready to Commit`
- `Status: Committed and Pushed`
- `Status: Blocked`

The goal is not rigid ceremony. The goal is to reduce ambiguity about whether:

- a plan or requirement change is only drafted or actually updated
- implementation is still pending or already complete
- verification has run or is still outstanding
- work is committed/pushed or only complete locally

## 3. Execution Preferences

- `requirements/`, `tech-specs/`, `plans/`, and Beads should each keep their
  own role
- Beads is the live tracker for active slices and larger-lane refinement
- use Beads for stable question/decision IDs when a discussion spans multiple
  modules or more than a few active open questions
- `requirements/` and `tech-specs/` are handoff artifacts and design inputs,
  not replacements for active plans
- when the user confirms a higher-level product or technical decision, infer and
  propagate the obvious downstream implications through requirements, specs,
  model, API, and implementation planning without asking the user to restate
  the same intent at each layer
- only escalate back to the user when the downstream implication creates a real
  fork, hidden risk, or non-obvious tradeoff
- prefer truthful lifecycle behavior over admin/test-only shortcuts
- when product consequences are non-obvious, confirm the decision before
  implementation expands
- keep persona boundaries clear and do not casually blur product, technical,
  frontend UX, backend, architecture, and QA ownership
- if a role boundary is unclear or a persona was misassigned in the current
  discussion, correct it proactively instead of making the user referee role
  ownership
- when a repeated role mix-up appears, update the relevant persona playbooks or
  shared rules in the same slice so the correction becomes durable
- a slice is not finished if the relevant local test suites are still failing
- do not treat "code complete" as finished work when validation is still red
- when a slice is complete and the relevant local tests are green, commit and
  push that slice before moving on to the next one

## 4. Testing And Truthfulness Defaults

- browser E2E should prefer stable selectors and URLs over copy assertions
- application code must not rely on fake data, mock payloads, or hardcoded
  fallback API responses
- if a workflow is not fully implemented yet, represent that honestly in UI and
  planning rather than masking it with placeholders that imply more than exists

## 5. AI Failure Modes To Resist

This is a solo + agent-driven workflow. There is no human catching loops in real time, so agents must self-detect a few specific failure patterns and surface them rather than absorbing them silently.

### Surface blockers, do not paper over them

- When stuck on a real obstacle (a test that won't pass for legitimate reasons, a contract that doesn't match the spec, an environment that won't connect), **stop and report**. State what was tried, what was observed, and what the obstacle is.
- Do **not** "make it work" by relaxing assertions, adding fallbacks to production code, swallowing errors, or commenting out the failing layer. Those are the patterns `rules/testing-rules.md` §1B / §1C explicitly forbid.
- Do **not** mark a slice as ready for review (or auto-merge) when the obstacle is unresolved. If the slice cannot legitimately close, it stays `in_progress` and the blocker goes to the user.

### Verify symbols, APIs, and CLI flags before using them

- Before calling a function, importing a module, using a CLI flag, or referencing a config key, confirm it exists in the codebase or in the actual tool's documentation. Use `grep`, `Read`, or the package's real docs — not memory.
- Inventing a plausible-sounding API that does not exist (a method on a library, an `--exclude` flag that the CLI doesn't actually support, a Zod helper that was never exported) is a routine failure mode. The fix is to verify before writing, not to debug after.
- When the codebase already has a pattern for the thing you need (a logger, an error helper, a builder), use that pattern. Do not introduce a parallel mechanism unless the existing one is genuinely unsuitable and you've named why.

### Do not retry the same failing approach

- If an approach failed once, the retry should be informed by what was learned — different command, different angle, different layer. Not the same command with the same inputs.
- After **two failed attempts** at the same fix, stop and surface the situation to the user. State what was tried, what failed, what hypothesis is being abandoned, and what the next reasonable angle would be.
- Loop detection: if you find yourself running the same failing command three times, you are in a loop. Stop, write down what you have observed, and ask.

### Do not silently expand scope

- A slice has a stated scope (in the Beads story description and the PR intent). If implementation reveals adjacent work that is genuinely needed, **declare the spillover and ask** before bundling it into the same slice. Do not silently expand the diff to include "while I was here" cleanup or refactors.
- If the adjacent work is small and unambiguous and the user has previously authorized inline cleanup, mention it explicitly in the PR description and the Beads closing note. The mention itself is the safety net.

### Do not invent product behavior

- When a use case is ambiguous, ask. Do not guess and write tests that codify the guess.
- When a contract field is unclear (nullable? required? what's the enum?), ask the backend persona or check the generated SDK. Do not assume.
- "Plausible default" is not a substitute for confirmed product intent. The cost of asking is much lower than the cost of un-shipping a wrong assumption.

---

## 6. Session Continuity

- when a session discovers a durable workflow preference, prefer capturing it in
  `rules/` or `docs/` rather than relying on conversational memory alone
- use `docs/SESSION-HANDOFF.md` for short “resume here” notes when a session is
  intentionally paused or the machine/repo context is about to change
- when product discussions resolve broad goals, actor behavior, or operating
  principles, update the shared `requirements/product-overview/` and
  `requirements/product-requirements/` artifacts continuously rather than
  letting important decisions accumulate only inside localized feature docs or
  chat history
