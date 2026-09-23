# PoolMaster — Product Definition Rules

Covers the three pre-implementation artifact layers: **discovery**
(`requirements/product-overview/`), **refined requirements**
(`requirements/product-requirements/`), and **technical specs** (`tech-specs/`).

**Read §0 first.** All three are high-leverage for a major new feature and net-negative
for incremental work, and the skip case is the common one in a mature codebase. The
authoring workflow — how to actually produce a bundle — is the `define-a-feature` skill.

---

## 0. When To Write These Artifacts (And When To Skip)

### Write a requirements bundle when all of these hold

- The feature is genuinely new — not already covered by an existing bundle.
- It introduces new actors, new domain concepts, new navigation surfaces, or substantially
  new product behavior.
- Product decisions benefit from shared framing *before* design or implementation begins.

### Write a tech spec when all of these hold

- The work is a major new feature or architectural change introducing substantial new
  domain types, API surfaces, or integration patterns.
- The product requirements are approved and current.
- Implementation has **not** started, and the spec will meaningfully reduce rework.

### Skip both when

- The work fits inside an existing feature's bundle or contract — no new actors, concepts,
  primary surfaces, domain types, endpoints, or integration patterns.
- The scope is a UX refinement, incremental improvement, refactor, or bug-class fix.
- Implementation has already begun and the design is emerging through review.
- The generated SDK types and existing tests already describe the behavior a spec would
  redocument.

**For every skip case, capture the narrative directly in the plan file (`plans/NN-*.md`).**
Do not create a parallel artifact that says the same thing in a different directory.

### These artifacts have lifetimes

- **Requirements bundles** — trim to current product intent once a feature stabilizes.
  Delete exploratory open-questions answered by shipping. Delete whole bundles for retired
  scope.
- **Tech specs are deleted on ship, not archived.** Once implementation lands on `main`
  with tests and the generated SDK reflects the final contract, the spec goes. Code, tests,
  generated types and OpenAPI descriptions are the authoritative post-ship spec; a parallel
  prose spec is pure drift risk. If spec work produced a durable decision that outlasts the
  feature, write an ADR *before* deleting.

Full lifetimes for every artifact layer are in `workflow-rules.md` §0 *Document Lifecycle*.

---

## 1. Purpose And Boundaries

| Layer | Answers | Must not become |
|---|---|---|
| Discovery | What is the product, who does it serve, what are its major parts? | Feature-level use cases, page-by-page detail, schema |
| Requirements | What must it do, and how do users experience it? | Schema, DTOs, routes, architecture |
| Tech spec | What contracts and concepts does building it imply? | A permanent reference document |

Discovery goes **wide, not deep**: product shape, primary actors, major modules, main goals
and constraints, open questions. When clarifying, ask a few broad framing questions rather
than field-level ones — that depth belongs to requirements.

None of these are the home of task status. That is GitHub Issues.

---

## 2. Output Structure

**Discovery** — `requirements/product-overview/`: `product-overview.md`, `prd.md`,
`actors.md`, `module-overview.md`, `open-questions.md`.

**Requirements** — `requirements/product-requirements/`:

- Shared: `product-requirements.md`, `roles-and-actors.md`, `glossary.md`,
  `domain-concepts.md`, `navigation-and-entry-points.md`
- Per feature, under `features/<feature>/`: `overview.md`, `use-cases.md`, `screens.md`,
  `business-rules.md`, `open-questions.md`

**Tech spec** — `tech-specs/features/<feature>/`: `domain-model.md`, `api-surface.md`,
`flows.md`, `open-questions.md`, plus `test-matrix.md` when coverage is planned up front.

Discovery inputs come from a kickoff prompt, `requirements/reference/`, or rough materials —
notes, screenshots, sketches. Discovery must still work when the only input is a prompt.

---

## 3. Confidence Labels

Use these labels where meaning or certainty matters:

- `(Confirmed)`
- `(Inferred)`
- `(Needs Review)`

Default rule:

- current approved user decisions, active plans, and implemented truth can be
  marked `(Confirmed)`
- synthesis from multiple inputs without direct explicit approval should be
  marked `(Inferred)`
- unresolved or risky assumptions should be marked `(Needs Review)`

---

## 4. Use Cases

Each important use case should normally include: ID/title, actor(s), preconditions,
trigger, main flow, alternate flows, error paths, expected outcomes, acceptance criteria,
and related business rules.

When visual references are supplied, extract product **meaning**, not implementation
mimicry. Note explicitly what the visuals confirm, what they inspire, and what they leave
unresolved. Spacing, layout and legacy control placement are not mandates unless the user
says so. Ask for a targeted screenshot rather than silently inferring important UX behavior
from incomplete prose.

---

## 5. Screens

Screen docs describe purpose, actor visibility and permissions, primary actions, major
states, dependencies on backend or other flows, and entry/exit points.

They are **not** component trees or layout blueprints.

---

## 6. Business Rules

Separate product rules, permission rules, lifecycle rules, and validation rules.

Do not bury a business-critical rule inside prose in one use case when it is reused across
several flows.

---

## 7. Tech Spec Content

- **`domain-model.md`** — entities and concepts, and for each one where it lives: domain
  type, DTO, persistence model, or derived read model only. Plus enum candidates and closed
  sets, lifecycle and status semantics, and model-change implications. Do not treat current
  implementation drift as automatically correct; call confirmed drift out explicitly.
- **`api-surface.md`** — a compact table: operation, actor/permission, request shape
  summary, response shape summary, constraints. Describe contract *meaning* rather than
  copying raw schemas.
- **`flows.md`** — end-to-end sequence, state transitions, branch and error points, and the
  interactions between UI, API and background processes. The test is whether someone can
  reason about the feature without reverse-engineering the code.
- **`open-questions.md`** — separate blocking questions, non-blocking follow-ups, and known
  drift between product intent and current implementation.

Before a spec is complete, cross-check it against the relevant requirements artifacts,
active plans, current shared domain types and DTOs, and the generated SDK/OpenAPI output.
Where implementation contradicts approved product direction, **record the mismatch** rather
than flattening the two together. A spec must not be used to route around an unresolved
product question.

---

## 8. Handoff Floors

**Discovery → requirements** must make clear: what the product or module is trying to
accomplish, who the primary actors are, what the major modules are, what key constraints
and assumptions exist, and what still needs product refinement.

**Requirements → tech spec or implementation** must make clear: the actors, the core use
cases, the business rules, the screen purposes and entry points, what is confirmed versus
open, and any technical or model implications already visible.

**Tech spec → implementation** must make clear: which concepts and contracts are affected,
where a model-impact classification is required, what the implementation baseline is, and
what coverage should be planned against.

---

## 9. Keeping These Current

These are not write-once artifacts, and the failure mode is product truth stranded inside
one feature's files.

- When a design discussion resolves product meaning, actor behavior, lifecycle rules, or
  navigation assumptions, propagate it up into the shared requirements files in the same
  effort — and into `requirements/product-overview/` when it changes high-level framing.
- While a feature is active, `requirements/product-requirements/` is authoritative for its
  product intent. If older plan prose contradicts current requirements, **requirements
  wins**; reconcile the plan or delete it if its epic has closed.
- When a requirement change affects in-flight work, update the plan narrative in the same
  effort. Task state moves in GitHub Issues.
- Do not raise a product question from old plan prose without first checking the current
  feature files.
