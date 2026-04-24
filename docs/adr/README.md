# Architecture Decision Records (ADRs)

An ADR captures a single durable decision that outlasts any individual feature slice — cross-cutting architectural or workflow choices that future contributors and agents need to understand the "why" behind.

ADRs complement the `rules/` layer:

- **`rules/*.md`** — *how* we build here (current conventions, checklists, requirements).
- **`docs/adr/*.md`** — *why* we chose the approach behind those rules (historical decision record).

An ADR and a rule may describe two sides of the same decision — that is fine.

## Properties

- **Short.** Target ~1 page. Title, status, context, decision, consequences, alternatives considered.
- **Numbered.** `NNNN-kebab-case-title.md`, sequential (`0001-…`, `0002-…`, …).
- **Immutable once accepted.** Do not edit historical ADRs. When a decision changes, write a new ADR that references and supersedes the old one; leave the old one in place for context.
- **Scoped to cross-cutting decisions.** Architecture patterns, cross-codebase conventions, hard boundaries, tooling choices. Not feature scope; not task lists; not things better captured in a plan or a rule.

## Statuses

- `Proposed` — draft for discussion; not yet in effect.
- `Accepted` — the current working decision.
- `Superseded by ADR-NNNN` — overridden by a later decision; kept for history.

## When to write an ADR

Good ADR candidates:

- Choice of a cross-cutting tool or convention (e.g. which task tracker, which API client, which test framework layer).
- A hard boundary that future work must respect (e.g. account-scope vs league-scope separation).
- A choice that was genuinely deliberated and has consequences if revisited.

Not ADR candidates:

- Feature scope or sequencing (those are plans).
- Implementation details local to a module (those are code comments or rules).
- Current process or rules (those are `rules/`).

## Authoring

1. Copy `docs/adr/0000-template.md` to the next sequential number.
2. Fill in Title, Status, Date, Context, Decision, Consequences, Alternatives considered.
3. Open a PR. Accept the ADR by merging; do not edit after that.

## Index

*(Add a one-line summary here when a new ADR lands.)*

- [ADR-0001 — Beads as the live task tracker](./0001-beads-as-live-task-tracker.md)
- [ADR-0002 — Plans are narrative; deleted after their Beads epic closes](./0002-plans-as-narrative-delete-after-epic-closes.md)
- [ADR-0003 — Tech specs are pre-implementation only; deleted after ship](./0003-tech-specs-pre-implementation-only.md)
- [ADR-0004 — Team is the league-facing entity; User page is account-scope only](./0004-team-centric-league-account-scope-boundary.md)
