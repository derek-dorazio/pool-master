# Plan 142 — Durable Product Documentation

**Tracking epic:** _not yet created_ — substrate depends on Plan 139.

## Purpose

Give durable product truth a permanent home that is named honestly and does not rot, and
make the ephemeral working artifacts that feed it consistent with each other.

The repository has three classes of ephemeral working artifact — product requirements,
tech specs, and plans — and all three are supposed to graduate their durable content into
a permanent layer before deleting themselves. Two of those permanent destinations exist
and are well defined (`rules/`, `docs/adr/`), a third was added recently (code comments at
the implementation site). **Durable product truth has no declared permanent home at all.**

So it has been landing in `requirements/`, which is supposed to be ephemeral.

## The model this plan completes

| Ephemeral artifact | Holds | Deleted when |
|---|---|---|
| `requirements/…/features/<feature>/` | Product intent for a feature being built | The feature ships |
| `tech-specs/features/<feature>/` | Technical framing before implementation | The implementation lands (ADR-0003) |
| `plans/NN-*.md` | Execution narrative for an effort | The parent tracker epic closes (ADR-0002) |

Each of the three graduates durable content out before it dies, into one of:

| Permanent home | Answers | Scope |
|---|---|---|
| Code comment at the implementation site | Why is *this code* like this? | Local; dies with the code |
| `rules/*.md` | How do we build here? | Conventions constraining code not yet written |
| **`docs/product/*.md`** (new) | What is **true** about the product? | Domain invariants, actors, information architecture |
| `docs/adr/*.md` | Why is the system like this? | Decisions, with the alternatives rejected |

The fourth row is what this plan adds. The three ephemeral classes are already correct and
are not changed here — plans in particular already delete on epic close under ADR-0002, and
this plan only makes that symmetry explicit rather than altering it.

## Governing Principles

- **Name artifacts for what they are.** "Requirements" means input. Content describing
  what is true about the shipped product is a description, not a requirement.
- **Do not write down what the code already states.** The strongest defense against stale
  documentation is never admitting the content that goes stale.
- **Proximity beats discipline.** Documentation that appears in the diff gets updated;
  documentation that requires remembering it exists does not.
- **Delete on doubt.** A missing doc is honest. A wrong doc is a trap.

## Triggering Findings

**The top-level product-requirements files have no declared lifetime.** `workflow-rules §0`'s
tier table lists `requirements/product-requirements/features/<feature>/` as Feature-life.
It does not mention `domain-concepts.md`, `roles-and-actors.md`,
`navigation-and-entry-points.md`, `glossary.md`, or `product-requirements.md` anywhere.
Neither does `§2`'s artifact hierarchy. They are a de facto permanent layer the document
lifecycle model does not acknowledge.

**They are already being used as a codification target.** Commit `67acca5` correctly
graduated plan 107's domain invariants into `domain-concepts.md` and `roles-and-actors.md`
and its build conventions into `rules/react-ui-rules.md`. The split was right; the
destination is undeclared.

**Cross-cutting content has landed in a feature-scoped bundle.** Commit `c2808f3` added
"PoolMaster Integrates; It Does Not Invent" — a principle constraining every adapter,
present and future — to
`requirements/product-requirements/features/contest-event-feed-integration/overview.md`,
which `§0` classifies as Feature-life, "retire/delete when the feature stabilizes." When
that bundle retires, a cross-cutting principle dies with it. It also overlaps
`rules/architecture-rules.md §3` *Provider and Adapter Registry Discipline*, which already
says missing provider configuration must surface as a typed error "not fabricated data."

**The existing lifetime rule is a half-measure.** `rules/product-requirements-rules.md`
says "when a feature has shipped and stabilized, trim the bundle to only what still
describes *current* product intent." That is neither delete-on-ship nor a permanent home —
it asks a bundle to become durable documentation in place, under a name that says it is an
input.

**Piper's discovery tree has the same problem.** `requirements/product-overview/` is
Piper's output, and Plan 133 retires Piper. Its content is either durable product truth or
dead.

## Key Decisions

### 1. `docs/product/` is the permanent home for product truth

Create it. Move the top-level `requirements/product-requirements/*.md` files there
substantially as-is — they are already the right content, in the wrong-named place:

- `domain-concepts.md` — entities and their invariants
- `roles-and-actors.md` — who exists and what they may do
- `navigation-and-entry-points.md` — product information architecture
- `glossary.md` — shared vocabulary

Audit `requirements/product-overview/` in the same pass: anything durable graduates here,
the rest is deleted with the tree.

### 2. `requirements/` becomes input-only and deletes on ship

Feature requirement bundles are written before and during a build, consumed by
implementation, and deleted when the feature ships — the same treatment tech specs received
under ADR-0003, for the same reason. This makes the three ephemeral classes symmetric and
easy to explain: **requirements, tech specs, and plans are all working artifacts that
graduate their durable content and then delete themselves.**

`rules/product-requirements-rules.md`'s "trim the bundle" rule is replaced by
"graduate and delete."

### 3. The admission test governs what may be written as durable prose

**If a type, schema, test, or OpenAPI description states it, prose must not.**

What survives the test — and why it survives refactors:

- **Invariants** the code enforces but never states. *"A user belongs to a league if and
  only if they own at least one team in it"* is scattered across services; no single file
  says it.
- **Principles** no type can express. *"PoolMaster integrates; it does not invent."*
- **Deliberate absences.** *"There is no league-level Members page."* Absences are
  invisible in code — you cannot grep for a decision not to build something.

What fails the test: endpoint inventories, DTO shapes, field semantics, and step-by-step
flows. The generated SDK, Zod schemas, OpenAPI descriptions, and tests state these better
and are never out of date.

This is the primary anti-staleness mechanism. Content that does not change when the
implementation changes does not go stale when the implementation changes.

### 4. No `docs/features/<feature>/` tree

Rejected deliberately, because it recreates the artifact ADR-0003 deleted.

ADR-0003 retired tech specs for post-ship drift: prose describing an implementation needs a
maintenance pass on every contract change, and that pass is not reliably done. A per-feature
document has the same failure mode with an additional weakness — a "feature" like
contest-event-feed-integration spans ingestion, scoring, and admin UI, so it maps to no
directory. Nothing forces a revisit when any one part changes. Ownerlessness is why tech
specs rotted.

Instead, durable behavioral documentation lives **co-located with the code it describes**,
at one of two levels:

**Package root** — `packages/<pkg>/README.md`, `clients/<app>/README.md`. Audience: someone
deciding whether to touch this package at all.

- What it is and where its boundary sits
- What it depends on and what depends on it — dependency direction is a rule
  `architecture-rules` enforces but no single file states
- How to run, build, and test it

**Module root** — `packages/core-api/src/modules/<module>/README.md`. Audience: someone
changing behavior inside it.

- What this domain module owns, and what it deliberately does not
- Its invariants — the rules it enforces that are scattered across its services
- **Domain events emitted and consumed.** The in-process event bus is an architectural
  seam (`architecture-rules §4`), and subscribers register elsewhere, so a module's event
  contract is genuinely hard to read off its own source. This is the highest-value content
  a module README can carry.
- Its boundary with sibling modules

Cross-module durable content does not go in either: `docs/product/` if it is a product
fact, `rules/` if it constrains how code is built, an ADR if it is a decision with
alternatives.

**This is demand-driven, not a sweep.** There are 23 modules under `core-api` and four
packages; only `mock-contest-feed-provider` and `clients/poolmaster` have READMEs today,
and `core-api` and `shared` have none. Writing 25 READMEs in one pass would produce exactly
the generic, immediately-stale prose the admission test exists to prevent. A README is
written when a module or package has content that passes the test — usually when durable
knowledge is being graduated out of a plan or requirement bundle. **An empty or generic
README is worse than no README**, because it looks like documentation.

`workflow-rules` *Documentation Expectations* already names package READMEs as something to
update when a change affects architecture, endpoints, or tests. That expectation stands; it
has simply never been populated. This decision gives it a defined shape.

### 5. Four mechanisms keep it current

Ordered by strength — the earlier ones do most of the work:

1. **The admission test** (decision 3). Prevention over maintenance.
2. **Proximity.** Module docs live with the module.
3. **An enforcement hook.** `workflow-rules §6` already carries a *Docs ride with code*
   rule, and it is a checklist item — the same shape as the plan-deletion checkbox that was
   skipped nine times. A `Stop` or pre-push hook that flags *module source changed, README
   untouched* converts it from an instruction into a prompt. Not a block; a question.
4. **Delete on doubt.** A doc that cannot be verified as current is deleted rather than
   left. ADR-0002's logic applied to documentation.

### 6. An ADR records the split

This has a genuine rejected alternative — keeping durable content in `requirements/`,
trimmed in place, which is what `product-requirements-rules.md` currently prescribes. A
rule cannot hold that rejection; an ADR can. Number assigned at authoring time.

## Data Model / API Surface Implications

None.

## Dependencies

- **`workflow-rules §0` governing rule 7** was added earlier in this plan set with a
  three-layer model (code comment / rules / ADR). It omits product truth and must become
  four. This plan owns that correction.
- **Plan 134** consolidates `rules/` on the prohibitions-over-inventories principle. These
  two plans both edit `§0` and `§2`; 134 should land first, or they should run together.
- **Plan 133** retires Pam, who nominally owned the requirements bundle. Ownership of
  `docs/product/` falls to ride-with-code — whoever changes the behavior updates the
  statement. Also retires Piper, which forces the `product-overview/` audit in decision 1.
- **Plan 139** introduces the `Stop` hook this plan extends for doc staleness. If 139 lands
  first the hook already exists; otherwise this plan adds the first one.
- **Commit `c2808f3`** should be revisited: the adapter theme moves to
  `rules/architecture-rules.md §3` (it constrains future adapters) or `docs/product/`,
  not a feature bundle. Its code comments stay.

## Execution Sequence

**First — create `docs/product/` and move the four top-level files.** Mechanical, and it
immediately gives the graduation target a name. Update every inbound reference.

**Second — update the model.** `workflow-rules §0` tier table and governing rule 7,
`§2` artifact hierarchy, `docs/adr/README.md`, `plans/README.md`. Write the ADR.

**Third — rewrite `rules/product-requirements-rules.md`** around graduate-and-delete, and
audit `requirements/product-overview/`.

**Fourth — relocate the adapter theme** from the feature bundle per *Dependencies*.

**Fifth — the staleness hook.** Add the module-README check.

Package and module READMEs are **not** created wholesale in this plan. They are written
when a module or package has durable content being graduated out of a plan or requirement
bundle, which happens naturally through Plan 141's audit and through ordinary feature work
afterward.

The one exception worth considering up front: `packages/core-api/README.md` and
`packages/shared/README.md` do not exist at all, and those two carry the most
dependency-direction weight in the repo. A short package-level README for each is
defensible as part of this plan rather than waiting for a trigger.

## Open Questions

- **Does `docs/product/` or `docs/` flat win?** `docs/` already holds operational runbooks
  (`DEVELOPER-SETUP.md`, `LOGGING-OPERATIONS.md`, `QA-CLEANUP-RUNBOOK.md`). A `product/`
  subdirectory separates product truth from operations, at the cost of one more level.
  Current lean is the subdirectory, since the two have different audiences.
- **What happens to `requirements/reference/`?** Seed materials for discovery. Probably
  dies with Piper, but worth confirming there is nothing in it worth graduating.
- **Is the module-README staleness check tolerable?** A diff touching a module for an
  unrelated reason will trigger it. If the false-positive rate is high the hook trains
  people to dismiss it, which is worse than not having it. Start it as advisory output and
  watch before making it louder.

## Sources / Prior Decisions

- ADR-0002 — Plans are narrative; deleted when the parent epic closes
- ADR-0003 — Tech specs are pre-implementation only; deleted after ship (the precedent this
  plan extends to requirements, and the cautionary tale behind decision 4)
- Plan 133 — Persona library to task-shaped skills (retires Pam and Piper)
- Plan 134 — Rules consolidation (edits the same `§0` and `§2` sections)
- Plan 141 — Plan directory reconciliation (its audit is where module READMEs originate)
- Commits `67acca5`, `c2808f3` — the codification passes that surfaced the gap
