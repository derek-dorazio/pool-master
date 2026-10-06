---
paths:
  - "packages/**/src/**"
  - "packages/shared/**/*.ts"
  - "clients/poolmaster/src/**"
---

# Production source — the Non-Negotiables

You are editing application code. These hold for every change here; each line cites its one
canonical statement, which wins if this summary ever disagrees.

- **No mock, fake, sample or fallback data, and no test-mode branches.** Missing data is a
  typed error or an honest empty state. `rules/architecture-rules.md` §3 *No Mock Data in
  Application Code*; `rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*.
- **Never change production code to make a test pass.** Fix the defect, fix the test, or
  move the test to a layer that can exercise the behaviour. `rules/testing-rules.md` §1B.
- **Respect the layer you are in.** Domain imports nothing; services never see HTTP;
  adapters are the only place that knows a Prisma row; one DTO per entity, with no viewer
  context on it. `rules/architecture-rules.md` §5 *Project Structure and Layer Boundaries*.
- **One code path per piece of business logic**, however many callers reach it.
  `rules/architecture-rules.md` §4 *Service Topology*.
- **A contract change regenerates the SDK in the same slice** — DTO, mapper, route schema,
  OpenAPI, generated client and its consumers move together. `rules/architecture-rules.md`
  §2 *Contract-First API Architecture*; the `add-endpoint` skill sequences it.
