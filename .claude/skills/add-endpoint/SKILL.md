---
name: add-endpoint
description: Adding or changing a backend API endpoint — the DTO → mapper → route → OpenAPI → SDK chain, in order, with the gate that catches each step being skipped. Use for any work that adds, changes, or removes a Fastify route in packages/core-api.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash]
---

# Adding or changing an endpoint

This is a **sequence**, not a checklist to satisfy in any order. Each step produces the
input the next one needs, and the common failure is doing step 3 first and back-filling.

The rules this routes to are authoritative. This file exists to say *what order* and
*what breaks if you skip*.

## The chain

1. **DTO** — define or update the Zod schema in `packages/shared/dto/`.
2. **Mapper** — map domain/service results to that DTO in
   `packages/core-api/src/mappers/<module>.mapper.ts`.
3. **Route** — `zodToJsonSchema()` in the Fastify route schema, with `tags`, `summary`,
   `operationId`, request schema, and a `response` schema **for every status the handler
   actually returns**.
4. **Regenerate** — `npm run api:refresh`, then `npm run api:validate`.
5. **Contract-verification case** — a `.safeParse()` assertion against the live response.

Full detail: `rules/service-rules.md` §4 *DTOs, Mappers, and OpenAPI*, including the
Contract Documentation Checklist you run before calling the work done.

## Where this goes wrong

- **Shaping the response in the handler.** Every route module needs a mapper file. Inline
  `.map()` in a handler is not a substitute, and "small", "admin-only" or "read-only" are
  not exemptions — the closed exemption list is `config` and `health`, and it is closed.
  Creating the mapper is part of the slice, not deferred cleanup.
- **Reusing a shared DTO and shaping locally anyway.** Reuse of the DTO does not license
  handler-level assembly. If no suitable mapper exists, extracting one is part of the slice.
- **Documenting the contract badly and expecting the frontend to read your source.** The
  generated SDK and OpenAPI descriptions are the frontend's spec. If a frontend question
  exposes a documentation gap, the fix is in the contract source — route summary,
  description, tags, DTO field and enum descriptions — not an answer in chat.
- **Leaving generated artifacts drifted.** The regenerate step is part of the slice. The
  frontend cannot start against a contract that has not been exported.

## Error responses

Error envelope shape and codes are in `rules/service-rules.md` §7. Typed error classes are
§7 *Typed Error Class Discipline* — and that discipline is currently clean in
`packages/core-api`, so a new plain-object throw would be the first.

## Before you call it done

`rules/testing-rules.md` §3 defines the gate set; `rules/workflow-rules.md` §3 says it is
not optional. Contract verification, unit, data integration and FAPI are **separate layers
with distinct goals** — a FAPI test is not a substitute for a unit test of the same logic.
