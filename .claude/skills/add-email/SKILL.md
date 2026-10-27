---
name: add-email
description: Adding or redesigning a system email — the template key and its registry entry, the data type and renderer built from the shared pieces, the notification category, settings switch and plan feature, the code that queues it, the tests, and a preview in a real inbox. Use when someone wants the app to send a new email or change how one looks or reads.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash]
---

# Adding an email

A system email is a typed renderer, not a stored template: one key, one entry in the
`EMAIL_TEMPLATES` registry in `system-email-templates.ts`, one data type, one renderer, and the
notification code that decides who gets it and when. What it looks like and may say is
`rules/ux-rules.md` §14 *System Email*; read it first. How email is queued, sent, switched off
and previewed is `docs/EMAIL-DELIVERY.md`.

## Step 1 — settle the email with the user

Write this table in the ticket, each open point a question with a recommendation. These are
product calls (who hears what, how often, in whose words), so they go to the user, not into
the code as guesses:

| Decision | What to settle |
|---|---|
| Audience | Who receives it: every active league member, commissioners only, the squad's owners, the account holder, root admins |
| Trigger and timing | What causes it, and whether it goes at once or at the overnight hour every scheduled league email shares (`EMAIL_CONFIG.weeklyDigestHour`, 3:00 AM US Eastern; `notifications/overnight-day.ts`), never an hour of its own |
| Frequency | Once per what (event, contest, league and day); this becomes the outbox idempotency key |
| Category | Which `EmailCategory` it belongs to, and so which profile switch turns it off; account and membership emails have none |
| Plan | Whether a plan can leave it out (a `PlanFeature` in the Emails group) or every league gets it |
| Header and button | Which header `rules/ux-rules.md` §14 item 2 gives it, and the one thing its gold button does |
| Words | Subject, preheader, title, body sentences and button label |

## Step 2 — the key

The key is a Postgres enum value as well as a domain constant (`rules/model-change-rules.md`
applies; it is an additive enum change):

1. Add it to `EmailTemplateKey` in `packages/shared/domain/enums.ts` and to
   `PrismaEmailTemplateKey` in `schema.prisma`, with a migration of one
   `ALTER TYPE "PrismaEmailTemplateKey" ADD VALUE '…';`, named after main's latest migration.
2. A new plan feature, if Step 1 chose one, goes in `PlanFeature` in the Emails group, with its
   label in the web app's plan labels and its value per plan in `plan-settings.ts`.

## Step 3 — the template

In `system-email-templates.ts`:

1. A data interface: everything the email shows, already decided by the caller. Dates as
   `Date`, links as finished URLs, the event as `EmailEventHeader` (built by
   `buildEmailEventHeader`) and a format as `EmailContestFormat`. No optional field the
   renderer then has to guess around.
2. Its line in the data-by-key map and in `EmailTemplateScopeByKey` (a league email or an
   account one).
3. The registry entry: category, plan feature or null, whether `EMAIL_CONFIG` has a switch for
   it, `keepsContent` (false when the email carries a secret such as a reset link), and
   `sendWithinMs` (a limit only when a late email is useless). A comment says why when the
   choice is not obvious.
4. The renderer, through `buildMessage`: pass `leagueName` whenever it comes from a league,
   the header option §14 item 2 calls for (`eventHeader`, `eventStrip` or `trophy`),
   `notAffiliatedWith` when it names a sport league, and exactly one `button`. Use the shared
   pieces (tiles, contest card, place callout, standings table, stats, countdown); a piece the
   email needs that does not exist is a new function beside them. Dates go through
   `formatDay` and a time only through `formatInstant`, per §14 item 8. Every `textLines`
   entry mirrors the HTML: same facts, every link on its own line.

The compiler now lists what is missing. Work through it: the switch in `config.dto.ts` and its
default in `email-settings.ts`, its label in the root admin settings page
(`root-admin-settings-utils.ts`), and an example in `tests/support/email-template-fixtures.ts`.

## Step 4 — queue it

The notification lives in `packages/core-api/src/modules/notifications/`, one file per kind of
notice, called by the service or scheduler step that knows the moment (`rules/architecture-rules.md`
§4 *Service Topology*: modules call each other's services, there is no event bus). It finds the
recipients, builds the data and calls `email.send(key, { to: emailRecipientOf(user), about,
league, data })` with an idempotency key that makes the frequency from Step 1 true. A missing
fact the email needs is a skip with a warning log (`rules/service-rules.md` §11 *Backend
Logging*), never a made-up value (`rules/testing-rules.md` §1B *Forbidden Application-Code
Patterns*). Wire new dependencies in the module's `wiring.ts`.

## Step 5 — tests

`rules/testing-rules.md` §1A and §1C apply; each test name says what the reader sees.

- `tests/unit/core-api/system-email-templates.test.ts`: the subject, the key lines of the plain
  text, the header and the button link, the empty and plural cases, and anything §14 forbids
  (a venue, a time in an email sent days ahead). The registry tests there list every key's
  category and plan feature; add the new one to both.
- The notice's unit test, over the in-memory world: who gets it, who does not, that it goes
  once, and the skip.
- An integration test on the Prisma adapters when the notice reads repositories in a new way
  (`rules/testing-rules.md` §9 and §9A).
- A changed email: search `tests/integration` and `tests/functional` for its old wording,
  because those lanes read the plain text of real sends.

## Step 6 — see it in an inbox

1. `npm run email:preview` writes every template to `tmp/email-preview/`; screenshot the new one
   at phone width (390 px) and desktop, and check long names do not wrap badly.
2. Update `docs/EMAIL-DELIVERY.md` where it lists emails, times or categories, in the same PR
   (`rules/workflow-rules.md` §6 *Docs ride with code*).
3. After the PR merges, the **Send email previews** workflow (Actions, manual, ref `main`)
   sends every template to one address through QA's SES; pass `to` and a `category` or `ALL`.
   Tell the user when it has run. The root admin's *Send a test email* on QA checks the sending
   setup, not templates.

## Traps

- A key without its migration passes unit tests and fails the first real send on QA.
- An email with no `leagueName` shows an empty right side of the brand bar; a unit test checks
  every league email names its league.
- The previews' pictures load from QA, so a new sport's photo shows in previews only after the
  deploy that carries it.
- Curly apostrophes come from shared names such as "Pick’em"; match them in expectations.
