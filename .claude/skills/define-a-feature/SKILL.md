---
name: define-a-feature
description: Authoring product-definition artifacts before implementation — a discovery bundle, a refined requirements bundle, or a technical spec for a MAJOR new feature. Use only when starting a genuinely new product surface with new actors or domain concepts. Most work skips all of this; for incremental work, a UX refinement, a refactor or a bug-class fix, capture the narrative in the plan file instead.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write]
---

# Defining a feature before building it

**Start by deciding whether to do this at all.** These artifacts are high-leverage for a
major new feature on a greenfield surface and net-negative for everything else — and in a
mature codebase, everything else is the common case. The write/skip criteria are
`rules/product-requirements-rules.md` §0 *When To Write These Artifacts (And When To Skip)*,
and the honest default is skip: put the narrative in the plan file and start building.

If you are here because a feature is genuinely new, the rest of this applies.

## The order

1. **Discovery** — only for a new product or a whole new module. Wide, not deep: product
   shape, actors, major modules, constraints, open questions. Skip for a feature inside an
   existing product.
2. **Requirements** — use cases, screens, business rules, open questions.
3. **Tech spec** — domain model, API surface, flows. Only when requirements are approved and
   implementation has not started.

Each layer's bundle structure and handoff floor are in
`rules/product-requirements-rules.md` §2 *Output Structure* and §8 *Handoff Floors*. Label
anything uncertain per §3 *Confidence Labels* — that is the mechanism that stops an
inference being read later as a decision.

## Ground the work in what is already true

Before proposing fields, steps, or page actions, read the current state and say which is
which:

- **Active product truth** — what the shipped product does today.
- **Backend contract surface that is not approved product UX** — an endpoint existing is
  not the same as a product decision having been made.
- **Superseded design ideas** kept only as historical reference.

Check the current shared domain types, the DTO/OpenAPI contract, and the implemented routes
and role behavior. **If the contract exposes retired or stale fields, do not design around
them silently** — say whether it is product scope diverging from backend capability, or
backend cleanup debt. Designing on top of a stale field bakes it in.

## Surface the backend implications before implementation starts

At the end of the definition pass, state explicitly what the proposed behavior requires:
schema or migration work, backfills, new DTOs or routes, auth/session or invitation-flow
changes. Confirm those with the user before implementation begins.

Where that implies a true model change, classify it and check it against the repo's model
conventions first — the `model-change` skill covers the sequence.

## Propose the end-to-end coverage

Name the browser journeys that should eventually prove the behavior, and decide whether an
existing journey extends or a new one is needed. Newly delivered user-facing behavior should
not sit outside the browser-journey plan by default.

Prefer real lifecycle flows — commissioner, member, public — over root-admin shortcuts. If
setup or cleanup seems to need a privileged API, ask first whether the real product
lifecycle should own that behavior.

## Review before locking it in

Put the use cases, open questions, backend implications and proposed journeys to the user
before the direction turns into implementation work. An early scaffold or placeholder page
does not define the final flow.

Once reviewed, treat the agreed journeys as planned work, not optional follow-up.

## Keeping it current afterwards

These are not write-once artifacts. When a later discussion resolves product meaning, actor
behavior, lifecycle rules or navigation assumptions, propagate it up in the same effort —
see `rules/product-requirements-rules.md` §9 *Keeping These Current*. The failure mode is
product truth stranded inside one feature's files.
