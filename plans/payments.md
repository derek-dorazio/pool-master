# Payments

**Tracking issue:** #931. Builds on `plans/monetization-strategy.md` (#581, plans epic #943).
Per-contest purchases: #968 (designed here, as phase 1).

Written 2026-10-24 for Derek's review; revised the same day after review on PR #967 and
Derek's direction: start with per-contest purchases on a capped Premium (100 on day 1, no
payment required), subscriptions later.
Design only; nothing here is built, and the build is deferred until Derek's go. Revised again
the same day: the six-month Premium gift with a drop to Free, and one plan matrix (§3). Phase 1 questions
(§13) were all decided by Derek on 2026-10-24; phase 2 questions wait for phase 2.

## TL;DR

- **Never touch a card.** Use **Stripe** (decided). Commissioners pay on Stripe's own
  checkout page. Poolmaster stores only Stripe's ids and what was bought. Card numbers never
  reach our servers, so the card-security rules (PCI) shrink to one self-assessment form.
- **Every league is gifted Premium for six months** (Derek 2026-10-24). Each league gets a
  renewal date, `planRenewsAt`: signup + 6 months (existing leagues: the move + 6 months).
  Until then it is on **Premium** (every feature, 100 entries per contest); after it, the
  league drops to **Free** (20 entries) and everything else just follows from the plan.
  Extending the gift is moving the dates out.
- **Phase 1, per-contest purchases** (Derek 2026-10-24). A commissioner pays once to
  **expand one contest**. Each plan has its own expansion price list, cheaper on higher
  plans. Payments are built and tested but not required on day 1.
- **Phase 2, annual plans later** (no monthly at first). Each plan's annual fee unlocks its
  features, a higher free cap and cheaper expansions (§15); paying for a year moves the
  league's renewal date out a year. Same Stripe customer, webhook and payment history.
- **Every plan has caps**, none unlimited: Platinum 500 entries free, expandable to 2000.
- **Stripe tells us what happened by webhook.** One endpoint, signature checked, each event
  stored once by its id so a repeat does nothing.
- **Our own payment history** for commissioners: date, amount, a description ("Masters
  pool: up to 50 entries"), the contest and who paid, with a link to Stripe's receipt.
- **QA runs Stripe's test mode** (fake cards, no money). Live keys exist only in production,
  in Secrets Manager through Terraform, like the JWT secret.

## 1. How online payments work, in plain terms

A **payment provider** (Stripe, Paddle, PayPal...) is the company that takes the card, talks
to the banks, and moves the money to your bank account. The app never sees the card; it sees
"checkout session cs_123 for contest X was paid, $10".

Three pieces do the work:

1. **Hosted checkout.** When a commissioner clicks "Expand to 50 entries", our server asks
   Stripe for a checkout page for that contest and that price, and sends the browser there.
   Stripe collects the card (and Apple Pay, Google Pay, Link), handles bank checks such as
   3-D Secure, and sends the browser back to the contest.
2. **Webhooks.** Stripe then calls a URL on our server ("this checkout was paid"). This, not
   the browser coming back, is what raises the cap: a browser can close, be faked or come back
   twice; a signed webhook cannot.
3. **Receipts.** Stripe emails the payer a receipt and keeps it at a link we store.

Phase 2 adds **subscriptions** (Stripe charging a price every month or year until cancelled)
and Stripe's **customer portal**, where a payer updates the card and cancels (Part B).

## 2. Provider

| | Stripe | Paddle | PayPal / Braintree | Square |
|---|---|---|---|---|
| Fees (US cards, approx., check at build) | 2.9% + 30¢, plus ~0.7% for subscriptions | ~5% + 50¢, all in | ~3.5% + 49¢ (PayPal) | 2.9% + 30¢ online |
| Hosted checkout and billing portal | Yes, both | Yes, both | Checkout yes, portal weak | Checkout yes, subscriptions basic |
| One-time payments too (per-event, #968) | Yes, same checkout | Yes | Yes | Yes |
| Sales tax and VAT | You are the seller; Stripe Tax can calculate and file for ~0.5% more | Paddle is the seller of record and handles all tax | You | You |
| Developer tools | Best in class: test mode, test cards, signed webhooks, typed Node SDK, CLI | Good | Dated | Fine |
| Fit for a small US-first site | Strong | Strong if tax is the main worry | Weak | Weak |

**Stripe (Derek decided 2026-10-24).** It is the default for a reason: the cheapest per payment at
our sizes, the clearest test mode, and the most examples to follow. Paddle is the one real
alternative: it becomes the legal seller and deals with every sales tax and VAT rule for
you, for roughly 2 points more per payment. That matters once a site sells in many US states
and abroad; at launch, with US leagues and payments of $10 to a few hundred dollars, Stripe
plus an accountant's check (§9) is simpler. The fixed 30¢ matters most on small per-event
payments: on $10 Stripe keeps about 59¢, Paddle about $1. Stripe has also been adding a
seller-of-record option of its own; if it is offered to us when we build, it is worth
comparing then. Lemon Squeezy is another seller-of-record service, now owned by Stripe.

Everything below assumes Stripe. The code keeps Stripe behind one module and one interface
(§10), so swapping later is contained, but not free.

# Part A. Phase 1: per-contest purchases

## 3. The launch setup: six months of free Premium, then Free

Derek's model (2026-10-24): every league is **gifted Premium for six months**, then drops to
**Free**. Plans, caps and features already do the rest; payments add per-contest expansions
now and annual plans later.

- **Every league on Premium.** The default plan for new leagues moves from Platinum to
  Premium, and existing leagues move from Platinum to Premium.
- **Renewal date.** Each league gets `League.planRenewsAt`: signup + 6 months for a new
  league, the day of the move + 6 months for an existing one. Commissioners see it on the
  plan page ("Your free Premium runs until 2027-04-24").
- **On the date, the league drops to Free.** A daily job moves every league whose date has
  passed (and that has no paid plan, phase 2) to Free, logged in the plan change log, after
  "Your free Premium ends in 30 / 7 / 1 days" emails to its commissioners. Nothing is
  deleted: contests over Free's cap keep their entries and take no new ones until expanded,
  and Premium features are hidden, not removed (*Moving to a lower plan* in
  `plans/monetization-strategy.md`). This job is the only new code the gift needs; the job
  can run twice safely. No grace after the date (Q12).
- **Extending the gift** is moving the dates out: a root admin action "Extend free Premium"
  that sets every gifted league's date (or one league's) to today + an interval, logged,
  rather than a database script.
- **Platinum is "Coming soon"** (Derek 2026-10-24). The commissioner plan picker shows
  Platinum but it can't be selected; Free, Pro and Premium stay selectable, which only ever
  lowers a league's caps. The root admin can still set any plan.

### The plan matrix (Derek 2026-10-24; prices tentative)

| | Free | Pro | Premium | Platinum |
|---|---|---|---|---|
| Annual fee (phase 2) | $0 | $49 | $99 | $199 |
| Features | Basics | + cups, championship, reminders, past years | + all-years summary, record book | Everything |
| Sports leagues per year | 5 | 15 | 30 | 50 |
| Free entries per contest | 20 | 50 | 100 | 500 |
| Expand to 50 entries | $10 | included | included | included |
| Expand to 100 | $20 | $15 | included | included |
| Expand to 200 | $30 | $20 | $15 | included |
| Expand to 500 | $40 | $30 | $20 | included |
| Expand to 1000 | — | — | $30 | $30 |
| Expand to 2000 | — | — | — | $40 |

- **Sports leagues** stay capped, but high enough to be practically unlimited (Derek: the
  per-contest fee is the real lever; the cap is protection against abuse).
- **Expansion prices are per plan**, a small price list each (round numbers, not a
  percentage), in the billing settings (§9). A gifted league is on Premium, so it pays
  Premium's prices with no special case; after the drop, Free's.
- **Features**: on the Plans page, the "starts at" of each feature matches the Features row
  (the all-years summary and record book move from Platinum to Premium). Free keeps the basics.
- Caps never fall as the plan rises; these numbers satisfy that.

- **Code change 1: Platinum gets a cap.** Today "Platinum is unlimited" lives in several
  places: `CappedLeaguePlan` and `CAPPED_LEAGUE_PLANS` in the shared enums, `PlanCapLimits`
  and `findFallingPlanLimit`, the Platinum branch in `resolvePlanEntitlements`,
  `PlanConfigSchema` (no Platinum key under either cap), and the Plans page, which shows
  Platinum fixed with "Platinum has no limits and every feature". Every plan becomes capped:
  caps are `Record<LeaguePlan, number | null>` over `LEAGUE_PLANS`, and the
  `CappedLeaguePlan` split is deleted as dead code. The "never falls as the plan rises" check
  covers Platinum too.
- **The saved settings row.** QA's stored `PLAN_CONFIG` has no Platinum values, so it would
  stop validating. The schema fills a missing Platinum value from the default when it loads,
  with a test proving an old row still loads; the next save writes it.
- **The matrix is the code defaults.** `PLAN_SETTINGS.defaults()` becomes the caps and
  features above (today Premium has 10 sports leagues, and the all-years summary and record
  book start at Platinum). Production then starts right
  with no manual save. QA keeps its saved row, so QA needs one save on the Plans page.
- **Order of the move.** On QA, change the plan settings first, then move the leagues; the
  other way round, every league would lose the all-years summary and record book in between.
  The migration moves **only leagues on Platinum**; a league whose commissioner picked Free or
  Pro stays there. Its log row has no `changedById` (the change log has no `source` column
  until phase 2, so it can't say "root admin" yet).
- **Copy.** "Every plan is free for now" and the Plans page's Platinum wording change to
  match Platinum showing as "Coming soon".
- **Code change 2: contest expansions** (§4) raise one contest's cap above its plan's.
- **Built before Stripe** (Derek 2026-10-24, superseding Q4): everything except the Stripe
  parts is built first, so expansions can be tried with no Stripe account. While
  `paymentsEnabled` is off, **expanding a contest is free and says so**: the commissioner sees
  "Expand to 200 entries: free while payments are off", the cap rises at once, and the
  history records a $0 expansion "Free while payments are off" (the same $0 record as a root
  admin grant). Nothing pretends a payment happened, which the no-fake-paths rule forbids
  (`rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*). When Stripe is set up
  and the switch turns on, the same button goes to checkout. Payments must be on in
  production before the first gifts end, when leagues drop to Free's 20.

## 4. Contest expansions

An **expansion** is a one-time purchase that raises one contest's entry cap.

- **Bands**: the sizes and prices in the matrix (§3), from the price list of the league's
  current plan, offered only where higher than the contest's cap. A contest can step up later
  by paying the difference against the band it **bought**, at its plan's current prices:
  a Free contest that bought 100 ($20) and moves to 200 ($30) pays $10. Every expansion is
  charged as an inline `price_data` amount worked out from the price list (the restricted key
  must allow it), so Stripe holds no Price per band; only the annual plans have Stripe Prices
  (phase 2).
- **The cap that applies** is the higher of the league's plan cap and the contest's
  expansion. `PlanEntitlementsService` works it out, so it stays the only place that decides
  caps; the existing counted insert (409 `CONTEST_FULL`) checks it unchanged.
- **Who buys**: any commissioner of the league. Members never see prices; they see "This
  contest is full" as today.
- **When**: any time until the contest stops taking entries (Q6). That is the moment of
  need: a contest filling up mid-signup. After that an expansion would do nothing.
- **It belongs to the contest for good.** A plan change never removes it; if the league later
  moves to a plan with a higher cap, the higher number wins.
- **A free expansion from the root admin** (Q7): for a favour, a dispute or testing, logged,
  shown in the payment history as $0 with the reason.
- **Refunds**: case by case from the Stripe dashboard (Derek 2026-10-24). A refund, full or
  part, only records the money returned; the expansion stays, with no special case. If you
  want the cap back down, a root admin lowers the band. A cancelled contest is not refunded
  automatically.

## 5. Buying an expansion, step by step

1. A contest fills up. Its commissioners see "This contest is full at 100 entries" (or
   whatever its cap is), with the bands above its cap from its plan's price list: "Expand:
   200 entries for $15, 500 for $20". Create contest and the contest's
   settings show the same choice before it fills.
2. The app calls `POST /contests/:id/expansions/checkout { band }`. The server checks the
   caller is a commissioner of the contest's league, the contest still takes entries, and the
   band is higher than what it has. Under the league's row lock it creates the league's Stripe
   customer if there is none yet (idempotency key from the league id), then a Checkout
   Session with `mode: payment`, the band's amount (or the difference for a step up), and
   `metadata` holding the league, contest and band, with success and cancel URLs back to the
   contest. The session id is stored; an earlier open session for the same contest is
   expired, so only one can be paid.
3. The browser goes to Stripe. The card never touches Poolmaster.
4. Stripe sends `checkout.session.completed` with `payment_status: paid`. The webhook (§6)
   records the expansion and the payment in one transaction.
5. The browser comes back to `?expanded=done`. The page shows "Finishing your payment..."
   and refreshes the contest until the new cap shows, usually a second or two. It never
   trusts the query string to grant anything.

**When the payment lands, the contest may have changed.** The checks in step 2 run when
checkout starts; the webhook can arrive later.

- **A paid session is always recorded.** The money is taken, so the webhook never rejects
  it. If the contest has stopped taking entries meanwhile, the expansion is recorded anyway;
  it is harmless.
- **The contest no longer exists** (deleted): the payment is recorded with no contest and
  flagged "Needs refund" on the root admin page, so it is never just a log line.
- **Two payments for one contest** (a race between commissioners): the higher band is kept;
  for the same band, the one Stripe created first is kept. The other is refunded in full and
  its payer emailed.
- **The cap is read inside the entry lock.** The contest's entry counter already reads the
  cap inside its lock; it gets the expansion there too, from `PlanEntitlementsService`, never
  passed in from outside. An expansion only ever raises the cap, so an expansion landing
  mid-entry can only let one more in, never wrongly refuse.

## 6. Webhooks and idempotency

One public endpoint, `POST /billing/stripe-events`, with no login: the signature is its whole
authority, like the SES events endpoint. It serves both phases.

- **Raw body.** Stripe checks the signature against the exact bytes it sent, so the body must
  not be parsed first. Stripe sends `application/json`; inside the billing module's own
  Fastify scope, the route removes the JSON parser (`removeContentTypeParser`) and adds one
  with `parseAs: 'buffer'`. Fastify keeps that change inside the module. A test proves the
  rest of the API still parses JSON normally. (The SES route is different: it parses
  `text/plain` as JSON and keeps no raw bytes, so it is not the pattern to copy.)
- **Signature.** The Stripe SDK checks the raw body against the endpoint's signing secret; a
  bad or stale signature (older than 5 minutes) gets 400 and changes nothing.
- **Pinned API version** in the SDK client and on the webhook endpoint, so event shapes match
  the typed SDK. Upgrading it is a deliberate change.
- **Stored once, with its effect.** The event id goes in a `billing_events` table with a
  unique index, in the same transaction as the effect, and an expansion is unique per
  Checkout Session. A repeat (Stripe retries until it gets a 2xx, for up to three days) finds
  the row and answers 200 without doing anything twice. If anything fails, the event row
  rolls back with the effect and the handler answers 500 so Stripe retries. The id is never
  stored first and processed later, which would lose the effect on a crash.
- **Unknown leagues and customers.** An event for something this database doesn't know is
  stored, logged and answered 200 (a paid session for a deleted contest is the exception
  above), so Stripe doesn't retry for three days. On QA this
  is normal after "Reset QA database", because Stripe's test data survives the reset.
- **Fast answer.** The handler does its database work and returns; emails go through the
  outbox as always, never sent inside the webhook.
- **Events in phase 1**: `checkout.session.completed` (and
  `checkout.session.async_payment_succeeded` if a slower payment method is ever enabled),
  `charge.refunded` (records the refund in the history; the expansion stays),
  `charge.dispute.created` and `charge.dispute.closed` (records the dispute and its outcome in
  the history; the expansion stays). Anything else is stored and ignored. Phase 2 adds the subscription events and a locked re-read (§17).
- **Daily check.** A daily job lists the last few days of paid Checkout Sessions from Stripe
  and applies any the webhook missed, through the same code. This covers a webhook lost for
  longer than Stripe retries (an outage on our side).

## 7. Payment history

Kept in Poolmaster, with a link to Stripe's receipt (Derek asked, 2026-10-24).

- **What a row shows**: date, amount, a description written when the payment lands ("Masters
  pool: up to 50 entries", "Masters pool: 50 to 100 entries", "Refund: Masters pool"), the
  contest, who paid, and a link to Stripe's receipt.
- **Who sees it**: every commissioner of the league, on league settings; each user also sees
  what they paid, across their leagues, on Account; the root admin sees it on the league's
  page. Members never see money.
- **Why our own, not only Stripe's**: Stripe shows a payment only to the person who paid, so
  co-commissioners would see nothing; Stripe doesn't know which contest a payment was for;
  and the root admin needs it when someone asks. It costs one row, written by the webhook.
  No card details are kept; Stripe's receipt holds the rest.

## 8. Emails and receipts

- **Receipts: Stripe's own** (Q9). Stripe emails the payer a receipt for every payment and
  every refund. They are correct by construction and legally formatted; we would only be
  copying them. Branding (name, logo, colour) is set in the Stripe dashboard.
- **Ours, through the email outbox** (`plans/email-notifications.md`), to commissioners only:
  "Your free Premium ends in 30 / 7 / 1 days" and "Your league is now on Free" (§3), and
  "<contest> was expanded to 50 entries by Sam" to the league's other commissioners. Account
  category, always sent; each with its own idempotency key.

# Shared by both phases

## 9. Tax, refunds, settings and environments

- **Sales tax.** In the US, whether access to a website is taxable differs by state, and you
  only owe a state once your sales there pass its threshold (commonly $100,000 a year). At
  launch that is very unlikely to apply, but it is a question for an accountant, not a
  design (Q10). Stripe Tax can be switched on later in the dashboard (about 0.5% per
  payment) and then calculates, collects and reports it; checkout just shows a tax line.
- **Disputes (chargebacks).** A payer's bank can reverse a payment; Stripe charges a fee
  (about $15) and emails you. You answer it in the Stripe dashboard; the webhook only records
  it in the history (§6). Rare at these amounts.
- **Before live payments**: Terms of Service with the refund rules, and a Privacy Policy
  naming Stripe (#921, which is waiting); a Stripe account verified with your business
  details and bank account; the PCI self-assessment (SAQ A, the short one for hosted
  checkout), which Stripe walks you through.
- **QA uses Stripe test mode**: separate keys, no real money, test cards (`4242 4242 4242
  4242` succeeds; others fail, need 3-D Secure, or decline). Anyone can try every path on QA
  safely. **Production uses live mode**, set up with the production environment (#917, on
  hold). Live keys never exist anywhere else.
- **Secrets, per environment, in Secrets Manager via Terraform**: `STRIPE_SECRET_KEY` (a
  restricted key limited to what we call) and `STRIPE_WEBHOOK_SECRET`, wired into the ECS
  task's `secrets` block like `jwt_secret` (`plans/production-environment.md` §6). Values come
  from `TF_VAR_...` at apply time, never committed. Hosted checkout needs no key in the
  browser.
- **Settings, per environment** (a new `BILLING_CONFIG` group on the root admin Settings
  page): `paymentsEnabled` (off until you say), the expansion bands with their Stripe Price
  ids, and in phase 2 the plan Price ids. Price ids differ between test and live, so they
  belong to the environment, not the code. While payments are off, no expansion is offered
  and nothing changes.
- **The webhook endpoint** is registered in each Stripe mode against that environment's URL
  (QA: `https://qa.ultimateofficepoolmanager.com/api/v1/billing/stripe-events`). Local work
  uses the Stripe CLI to forward test events to a laptop.

## 10. How it fits the code

- **A new `billing` module** in `packages/core-api/src/modules/`, the only code that knows
  Stripe exists. Its `BillingProvider` port (create customer, create and expire checkout
  sessions, list paid sessions, refund; phase 2 adds subscriptions) has one Stripe adapter
  using the official `stripe` Node package. Other modules call `BillingService`, never Stripe
  (`rules/architecture-rules.md` §4 *Service Topology*, §5 *Project Structure and Layer
  Boundaries*).
- **Caps stay in one place.** `PlanEntitlementsService` takes the league's plan and the
  contest's expansion and returns the cap; the contest's entry counter and 409
  `CONTEST_FULL` are unchanged. The `no-plan-branching` lint rule still applies.
- **A league is a tenant** (`rules/domain-model-concepts.md` *A league is a tenant*): its
  Stripe customer, payments and receipts belong to that league. One Stripe customer per
  league, whose contact is whoever paid last; one person paying in two leagues is two
  customers.
- **Model changes, phase 1** (`rules/model-change-rules.md`):
  - `contest_expansions`: contest, band (entry cap), the payment it came from (or the root
    admin grant and reason), who bought, when. One current
    expansion per contest; a step up replaces it, keeping history.
  - `league_billing`: one row per league: Stripe customer id, open Checkout Session ids.
  - `billing_events`: Stripe event id (unique), type, received and processed times, and
    whether its league or contest was unknown.
  - `league_payments`: league, contest (optional), payer, a typed kind (`CONTEST_EXPANSION`,
    `REFUND`; `SUBSCRIPTION` in phase 2), amount, currency, description, Stripe payment id
    and receipt link.
  - Platinum joins `CAPPED_LEAGUE_PLANS`; the default plan becomes `PREMIUM`.
  - `League.planRenewsAt` (date): signup + 6 months, or the move date + 6 months for
    existing leagues; phase 1 only shows it.
- **Routes, phase 1**: `POST /contests/:id/expansions/checkout`, `GET /billing/prices`
  (public: bands now, plan prices in phase 2; empty while payments are off),
  `GET /leagues/:id/payments`, `GET /users/me/payments`, `POST /billing/stripe-events`, and
  a root admin `POST /contests/:id/expansions/grant`. The contest DTO already carries its cap
  and entry count; it gains the expansion band. All contract-first with DTOs and the
  generated client (`rules/service-rules.md` §4 *DTOs, Mappers, and OpenAPI*).
- **Screens**: the "full" notice and Expand choice for commissioners on the contest, Create
  contest and contest settings; Payments on league settings and on Account; the root admin
  league page lists payments, grants expansions and links to Stripe.
- **Tests** (`rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*): no Stripe
  fakes in app code. Unit and integration tests run against a fake `BillingProvider` defined
  in test code; webhook tests post real signed payloads built with the Stripe SDK's test
  signature helper, including a repeat, a refund and an unknown contest; a manual QA
  checklist covers the real test-mode paths (pay, decline, 3-D Secure, step up, refund). No
  Stripe network calls in CI.

## 11. Security notes for review

- No card data, ever; only Stripe ids, amounts and receipt links.
- The webhook trusts nothing but the signature; the browser's return never grants anything.
- Checkout routes check the caller is a commissioner of the contest's league; the grant
  route is root admin only.
- The Stripe key is restricted to the calls we make; rotating it is a Terraform apply.
- Logs carry league, contest and Stripe ids, never card details or full customer emails
  (`rules/service-rules.md` §11 *Backend Logging Conventions*).

## 12. Slices

Filed under #931. Derek (2026-10-24): build everything except Stripe now (#986, #980,
#987); the Stripe slices (#979, #981, #985) and phase 2 stay deferred.

**Phase 1**

1. **Stripe account and secrets** (#979). You create the Stripe account (test mode is
   enough); a thread adds the two secrets to Terraform for
   QA and the `BILLING_CONFIG` group, switch off. No behaviour change.
2. **Launch plan setup** (#986). Platinum gets a cap, the matrix becomes the defaults, the
   default plan becomes Premium, existing leagues move to Premium with a renewal date six
   months out, Platinum shows as "Coming soon" in the picker, and the daily job drops leagues
   to Free on their date after the 30 / 7 / 1 day emails, with the root admin's "Extend free
   Premium". Removes the `CappedLeaguePlan` split, fills a missing Platinum
   value in the saved settings, puts the day 1 numbers in the code defaults, and moves only
   Platinum leagues, after QA's settings are saved (§3). Can be built before any payments.
3. **Model** (#980). Expansions and payments tables (the Stripe-only billing and events
   tables can wait for #981); entitlements combine plan and expansion. No behaviour change,
   because no expansion rows exist yet.
4. **Checkout and webhook** (#981). The `billing` module, expansion checkout, the webhook,
   the daily check, prices route, "Finishing your payment". Switch stays off.
5. **Commissioner screens and history** (#987). The full notice and Expand choice (free while
   payments are off), payment history on league settings and Account, the "contest expanded"
   email, root admin payments and grants. Built before #981; #981 then adds checkout behind
   the same button, the receipt links and the `docs/PAYMENTS.md` runbook.
6. **Going live** (#985). With production (#917) and Terms (#921): live keys and Prices,
   webhook registered, Stripe Tax decision. Switch expansions on in production before the
   first gifts end (§3).

**Phase 2** (subscriptions, Part B): #982, #983, #984, revised when Derek wants them.

## 13. Questions

Each has a recommendation; answer only where you disagree.

**Decided (Derek 2026-10-24):** Stripe; every league gifted Premium for six months, then Free;
per-contest expansions with a price list per plan; the plan matrix in §3; payments built and
tested but not required on day 1; our own payment history with a link to Stripe's receipt;
annual plans later, no monthly at first. Later answers win over earlier ones below.

1. **Decided (Derek 2026-10-24): yes**, existing leagues move to Premium too, and every league
   gets a renewal date six months out (§3).
2. **Decided (Derek 2026-10-24): Platinum shown as "Coming soon" and not selectable**; the
   other plans stay in the picker (§3).
3. **Decided (Derek 2026-10-24):** caps as in the matrix (§3), replacing the first answer
   (Platinum 1000, unlimited sports leagues).
4. **Decided (Derek 2026-10-24): yes.** Day 1 in production: payments built but switched off,
   so no prices show; on in QA test mode. They go on in production before the first gifts end.
5. **Decided (Derek 2026-10-24):** bands and prices per plan as in the matrix (§3), stepping
   up for the difference; prices are settings, changed without code.
6. **Decided (Derek 2026-10-24): yes.** Buy any time until the contest stops taking entries.
7. **Decided (Derek 2026-10-24): yes.** The root admin can grant an expansion free, with a
   reason; it shows in the history as $0.
8. **Decided (Derek 2026-10-24): no automatic refunds; you refund case by case in Stripe.**
   A commissioner who wants money back emails you; you open the payment from the root admin
   link and press Refund in Stripe (full or part); Stripe returns the money to the card in
   5 to 10 days and emails a refund receipt; the webhook marks the payment refunded in the
   history. The expansion stays (Derek: whichever is simpler). A cancelled contest is not
   refunded automatically. Stripe keeps its fee on a refunded payment (about 59¢ on $10).
   Written into the Terms (#921).
9. **Decided (Derek 2026-10-24): yes.** Stripe sends receipts; we send only the gift-ending
   reminders and "contest expanded".
10. **Decided (Derek 2026-10-24):** no sales tax at launch; ask an accountant, turn on
    Stripe Tax when needed.
11. **Decided (Derek 2026-10-24): nothing needed now.** Test mode uses the bands above; the
    live amounts are set in the billing settings when phase 1 goes live (#985).

12. **Decided (Derek 2026-10-24): no grace** when a gift ends: the league moves to Free on
    its date; the 30 / 7 / 1 day reminders are the warning.
13. **Decided (Derek 2026-10-24):** Free keeps what PLAN_CONFIG gives it today: contest
    opening, receipt and results emails, every contest type and the leaderboard, 20 entries
    per contest, 5 sports leagues a year. The rest is hidden, never deleted.
14. **Decided (Derek 2026-10-24):** "Extend free Premium" is a root admin action for one
    league or every gifted league at once, logging who extended it and to when.

## 14. Monetization order (Derek 2026-10-24)

Derek expects the first money to come from per-contest fees, not plans: few will pay around
$200 a year for a plan until they have paid per-contest fees and see they would pay more than
that over a year. So phase 1 sells only expansions, with every league gifted Premium
for six months and then on Free, and phase 2 sells annual plans. `plans/monetization-strategy.md` carries the same order.

# Part B. Phase 2: subscriptions (later)

Designed and reviewed on PR #967; kept here so phase 2 starts from it. Questions on it
(grace length, proration, comps) are parked until phase 2 is picked up.

## 15. What a league subscribes to

- **One annual subscription per league** (Derek 2026-10-24: no monthly at first). The plan's
  fee is in the matrix (§3); one Stripe Product per paid plan with an annual Price, Price ids
  in `BILLING_CONFIG`.
- **Paying moves the renewal date.** A paid year sets `planRenewsAt` to the end of the paid
  period, so the same daily job that ends a gift ends an unpaid plan, and a gifted league
  that subscribes early keeps its gift until its date.
- **Paid by one commissioner**, the payer, on the league's Stripe customer; every
  commissioner sees the plan, payer and next charge; another commissioner can take over.
- **Expansions keep working** on any plan, at that plan's prices.
- **Where it starts**: the plan comparison pages (`plans/plan-comparison-pages.md`); without
  monthly, their Yearly / Monthly toggle goes.
- **Why these prices.** Each annual fee is about five expansions at that plan's size, so a
  league running five or more sizeable contests a year saves by subscribing. Against the
  market (`plans/monetization-strategy.md` *What other sites charge*): per-entry pool sites
  charge about $100 for one 50-entry pool and $175 for 100; fantasy commissioner upgrades run
  $130 to $180 a season. Premium at $99 is well under both; Platinum at $199 sits at CBS's
  level for far larger pools.

## 16. Checkout, changes and hand-over

- **Checkout**: `POST /leagues/:id/billing/checkout { plan }`, `mode: subscription`,
  under the league row lock with one customer per league and earlier open sessions expired,
  as in §5.
- **Who is in charge of the plan**: with a subscription, billing is; the free picker is
  refused with a pointer to the plan page, and the webhook and reconcile set the plan from
  the subscription. Without one, a lower plan is free and a higher one needs checkout. The
  root admin can comp a league; how a comp survives billing (a marker, or a free period
  date that billing respects) is settled with the phase 2 launch rule.
- **Moving up** applies at once with a prorated charge; **moving down** takes effect at
  period end, as a subscription schedule we create and read back.
- **Customer portal** for card updates and cancelling only; plan switching and invoice
  history off, so plan changes go through our rules and no payer sees invoices addressed to
  another.
- **Take over billing**: set the new card as the default payment method, detach the old
  payer's cards, replace the customer's name, email and address, email the old payer.
- **Failed cards**: Stripe's Smart Retries (about two weeks) are the grace period, then the
  subscription cancels.

## 17. Subscription webhooks

On top of §6:

- **Read, then apply under a lock.** For a subscription event, the handler re-reads the
  subscription and its schedule from Stripe outside any transaction, noting when it read
  them; then, in one transaction, it locks the league's billing row (`SELECT ... FOR
  UPDATE`) and writes only if its read is newer than the stored `lastSyncedAt`. Two events at
  once cannot let the older read win, and order stops mattering.
- **Events**: `customer.subscription.created`, `.updated`, `.deleted`,
  `subscription_schedule.updated`, `invoice.paid` (payment history), `invoice.payment_failed`
  (banner).
- **Nightly reconcile** re-reads every league with a subscription through the same locked
  apply, skipping unknown leagues.

| Stripe subscription status | League plan |
|---|---|
| `active` | the plan of its Price |
| `past_due` (card failing, Stripe retrying) | kept, with a banner for commissioners |
| `canceled`, `unpaid`, `incomplete_expired` | what the phase 2 launch rule says unpaid leagues get |
| `incomplete` (checkout started, card not confirmed) | unchanged |

- **Model additions**: on `league_billing`, the payer, subscription id, plan and period
  paid for, a typed status enum mirroring Stripe's, current period end, next plan and when,
  cancel-at-period-end, `lastSyncedAt`; `league_plan_changes` gains a typed `source`
  (`COMMISSIONER`, `ROOT_ADMIN`, `PAYMENT`, `PAYMENT_ENDED`).
- **Our emails**: you're now the payer, billing needs a new owner, your plan ends on ...
