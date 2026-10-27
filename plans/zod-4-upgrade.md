# Zod 4 upgrade

**Tracking issue:** #1137

Written 2026-10-27. zod below 4.6.6 has a high-rated advisory, GHSA-mrhx-c7xc-m3w5: validating
an oversized array or record against a size limit can exhaust memory. zod 3 gets no fix, so the
only way out is zod 4. Derek approved the major the same day; Dependabot's own PR (#1132) was
closed in favour of this plan, because the bump cannot land without code changes.

## What zod does here

- `packages/shared` holds every DTO as a Zod schema. They are converted to JSON Schema for two
  readers: Fastify, whose Ajv validates every request and whose serializer shapes every
  response, and `@fastify/swagger`, which publishes the OpenAPI document that hey-api and
  openapi-typescript generate the web app's types from.
- core-api does not run Zod on requests. **What Ajv receives is the API's real validation.** So
  the converter's output is the thing this upgrade must not change by accident.
- The web app parses forms and uploads with Zod directly (about 26 files).
- `zod-to-json-schema` does not support zod 4. Zod 4 ships its own converter, `z.toJSONSchema`.

## How we prove nothing moved

`packages/shared/generated/openapi.json` is committed and `api:check` fails when it is stale, so
every change to the converter's output shows up as a diff of that file. The PR regenerates it and
the PR body accounts for every kind of change in it.

It is one PR; the deprecated-forms section says why it could not be two.

## The bump and the converter

- zod 4.6.7 in `@poolmaster/shared` and the web app; `zod-to-json-schema` removed.
- `dto/json-schema.ts` converts with `z.toJSONSchema` (target `openapi-3.0`, output types, so
  objects keep `additionalProperties: false` and Fastify's `removeAdditional` keeps stripping
  unknown request fields). Three adjustments keep the API validating as it did:
  - **Format patterns dropped.** Zod 4 publishes its own regex next to `format: uuid`,
    `date-time` and `email`. Those are stricter than the Ajv formats the API has always used (a
    uuid must carry an RFC version and variant; a date-time must end in `Z`). Only the `format`
    is kept. A `pattern` a DTO declares itself with `.regex()` stays.
  - **Unions published as `anyOf`.** Zod 4 publishes a discriminated union as `oneOf`. Ajv
    checks every `oneOf` member, and with `removeAdditional` a non-matching member strips fields
    the matching one needs (the bug behind the "survivor last" rule, #711). `anyOf` stops at the
    first match, as before.
  - **`x-transform` kept.** Zod 4 builds `.trim()`, `.toLowerCase()` and `.toUpperCase()` as one
    kind of check holding a bare function, so the converter tells them apart by running it on a
    probe string. An unknown overwrite throws at boot rather than silently skipping the
    normalisation #500 added.
- `.extend()` no longer carries a `.describe()` text to the new schema. The rules unions build
  their members with a small `extendRules` helper that keeps it.
- The forced source changes: `z.record` takes a key schema, `invalid_type_error` / `errorMap`
  become `error`, `ZodTypeDef` is gone, a refine's message function becomes a `superRefine`.
- `@hookform/resolvers` 3 to 5: version 3 cannot read Zod 4 errors, so no form showed its
  field messages. Version 5 types a form by its schema's input and output; the two forms with
  a coerced number say both.
- Root admin settings show Zod 4's wording for an unlabelled number limit ("Too small: expected
  number to be >=1" in place of "Number must be greater than or equal to 1"). Three tests
  follow it. Product-worded messages for those fields would be a small follow-up.
- Test fixtures that used made-up ids such as `11111111-1111-1111-1111-111111111111` get valid
  ones: Zod 4's `.uuid()` checks the version and variant. Every real id is valid
  (`gen_random_uuid()`, and every id written in a migration was checked).

What the OpenAPI diff shows, and why each is right:

- `minimum` / `maximum` of ±2^53−1 on every integer: Zod 4 states the safe-integer range. True
  and harmless; no generated type changes.
- About 50 corrected descriptions and 8 corrected nullabilities. `zod-to-json-schema` reused one
  converted node for a schema used twice, so a field could show a sibling's description
  ("Expected return timestamp when known." on `createdAt`) or its `| null`
  (`TeamOwnerInvitationDto.createdAt`, a preview row's `after`). The generated types now match
  the DTOs.
- `IngestionScheduleConfig.scheduledSports` is required: it has a `.default()`, so the server
  always returns it. It is only a response; requests use the override schema.

## Same PR — the deprecated forms

The plan was a second PR for these. It cannot be: lint runs `@typescript-eslint/no-deprecated`,
so the bump alone fails the lint gate. They ride in the same PR. The change
is a mechanical rewrite and leaves the OpenAPI document unchanged (`api:check` proves it):

| v3 form | Zod 4 form | Sites |
|---|---|---|
| `z.nativeEnum(E)` | `z.enum(E)` | 127 |
| `z.string().uuid()` | `z.uuid()` | 158 |
| `z.string().datetime()` | `z.iso.datetime()` | 52 |
| `z.string().email()` | `z.email()` | 1 |
| `z.string().trim().email()` | `z.string().trim().check(z.email())` | 2 |
| `.passthrough()` | `.loose()` | 2 |
| `.removeDefault()`, `ZodTypeAny`, `ZodIssueCode` | `.unwrap()`, `ZodType`, `'custom'` | 3 |

An email field that trims keeps `.check(z.email())` after the trim: `z.email().trim()` would
check the address before trimming it, and a pipe would publish only the email side, losing the
`x-transform` the API needs. `no-deprecated` is the guard that keeps the v3 forms out; no new
lint rule is needed. Forms Zod 4 still supports without deprecation (`message:` in a check,
`.strict()`, `superRefine`) stay as they are.

The PR also drops the converter's local `$ref` inlining: Zod 4 inlines a reused sub-schema
itself, and the converter now refuses a recursive schema (`cycles: 'throw'`), so no local ref
can appear. The nullable-enum, nullable-union and single-`allOf` fixes stay; their tests show
Zod 4 still produces those shapes.

## Questions, with the answer this plan takes

1. **Should the API start using Zod 4's stricter uuid and date-time checks?** No, not in this
   upgrade. It would refuse a date-time with an offset that it accepts today, and the gain is
   small: real ids are already valid. If wanted later, it is one line in the converter plus the
   test fixtures, as its own ticket.
2. **Keep the safe-integer bounds in the spec?** Yes. They are true, Ajv enforces them cheaply,
   and dropping them would be code written only to keep a diff small.
3. **Publish the document as OpenAPI 3.1 straight from Zod (target `draft-2020-12`) and drop
   `nullable-to-3-1.ts`?** Not now. Fastify's Ajv is draft-07, and the rewrite works. Worth a
   look later.
