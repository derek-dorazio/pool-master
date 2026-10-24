# Payments

**Tracking issue:** #931. Builds on `plans/monetization-strategy.md` (#581, plans epic #943).
Per-contest purchases: #968 (designed here, as phase 1).

Written 2026-10-24 for Derek's review; revised the same day after review on PR #967 and
Derek's direction: start with per-contest purchases on a capped Premium (100 on day 1, no
payment required), subscriptions later.
Design only; nothing here is built, and the build is deferred until Derek's go. Questions are
in §13, each with a recommendation; answer only where you disagree.

## TL;DR

- **Never touch a card.** Use **Stripe** (decided). Commissioners pay on Stripe's own
  checkout page. Poolmaster stores only Stripe's ids and what was bought. Card numbers never
  reach our servers, so the card-security rules (PCI) shrink to one self-assessment form.
- **Phase 1, per-contest purchases first** (Derek 2026-10-24). Every league is on **Premium**,
  with every feature switched on for Premium in the plan settings, and a cap of **100
  entries per contest** on day 1, so nobody has to pay. A commissioner can pay once to
  **expand one contest**. Payments are built and tested but not required on day 1; lowering
  the cap (for example to 20) later is one save on the Plans page. No subscriptions, renewals
  or recurring charges.
- **Phase 2, subscriptions later**: annual or monthly plans per league, monthly at a premium
  ($99 a year or $9.99 a month as the example). Designed in Part B, built when Derek wants
  them, on the same Stripe customer, webhook and payment history.
- **Long-term caps** (Derek 2026-10-24): Platinum is capped at 1000 entries per contest
  rather than unlimited; Premium returns to 100 once subscriptions are sold.
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

## 3. The launch setup: everyone on Premium, capped at 100, payments built but not required

Derek's plan (2026-10-24): try everything, with entries limited, and paying per contest lifts
the limit. On day 1 the limit is generous, **100 entries per contest**, so nobody has to pay
and adoption is not blocked. Payments are built and tested (on QA in Stripe's test mode) so
they are ready; lowering the cap to make them matter is a later decision, one save on the
Plans page. Almost all of it is plan settings that already exist; only two things need code.

- **Every league on Premium** (Derek 2026-10-24). The default plan for new leagues moves from
  Platinum to Premium, and existing leagues move from Platinum to Premium, logged in the plan
  change log as a root admin change.
- **Renewal date: six months out** (Derek 2026-10-24). Each league gets `League.planRenewsAt`:
  signup + 6 months for a new league, the day of the move + 6 months for an existing one.
  Phase 1 only stores and shows it (to commissioners, on the plan page); nothing happens on
  the date until phase 2 says what renewal means.
- **Platinum is "Coming soon"** (Derek 2026-10-24). The commissioner plan picker shows
  Platinum but it can't be selected, labelled "Coming soon"; Free, Pro and Premium stay
  selectable, which only ever lowers a league's caps. The root admin can still set any plan.
- **Every feature on Premium.** On the Plans page, each feature's "starts at" is set to
  Premium or lower. Platinum then differs from Premium only by its caps until subscriptions
  are sold.
- **Caps on day 1** (decided, Derek 2026-10-24), entries per contest / sports leagues per year:
  Free 20 / 1, Pro 50 / 3, Premium 100 / unlimited, Platinum 1000 / unlimited.
  These are the original long-term numbers, with Premium given every sports league so every
  league can try every sport. Caps must not fall as the plan rises, which these satisfy.
- **Code change 1: Platinum gets a cap.** Today Platinum is hard-wired to unlimited
  (`CAPPED_LEAGUE_PLANS` leaves it out, and the Plans page shows it fixed). Platinum joins the
  capped plans, starting at 1000 entries per contest; the "never falls as the plan rises"
  check still guards it.
- **Code change 2: contest expansions** (§4) raise one contest's cap above its plan's.
- **Day 1 in production** (Q4): payments built, but expansions not offered (`paymentsEnabled`
  off), so nothing about money shows. On QA the switch is on in test mode, so the whole flow
  can be tried with test cards, including on test leagues whose cap the root admin lowers.
- **Later, when payments should matter**: you lower Premium's cap (Derek's example: 20) on a
  date you announce, and switch expansions on. One save hits every league the same day;
  commissioners get an email about two weeks before, and contests already over the new cap
  keep every entry and take no new ones until expanded (the existing *Moving to a lower plan*
  rule in `plans/monetization-strategy.md`). Free and Pro must then be at or below Premium's
  new cap; nobody can buy them yet, so that is harmless.

## 4. Contest expansions

An **expansion** is a one-time purchase that raises one contest's entry cap.

- **Bands** (Q5), above whatever the plan allows: up to 50 entries for $10, up to 100 for
  $20, up to 200 for $30, up to 500 for $40 (Derek 2026-10-24), offered only where higher
  than the contest's cap. A contest
  can step up a band later by paying the difference. The bands and their Stripe Prices live
  in the billing settings (§9); the amounts shown on screen are read from Stripe.
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
- **Refunds**: case by case from the Stripe dashboard (Q8). A refund removes the expansion;
  entries already in stay (never remove), and the contest takes no new ones while over cap.
  A cancelled contest is not refunded automatically.

## 5. Buying an expansion, step by step

1. A contest fills up. Its commissioners see "This contest is full at 100 entries" (or
   whatever its cap is), with the bands above its cap: "Expand: 200 entries for $30, 500
   for $40". Create contest and the contest's
   settings show the same choice before it fills.
2. The app calls `POST /contests/:id/expansions/checkout { band }`. The server checks the
   caller is a commissioner of the contest's league, the contest still takes entries, and the
   band is higher than what it has. Under the league's row lock it creates the league's Stripe
   customer if there is none yet (idempotency key from the league id), then a Checkout
   Session with `mode: payment`, the band's Price (or the difference for a step up), and
   `metadata` holding the league, contest and band, with success and cancel URLs back to the
   contest. The session id is stored; an earlier open session for the same contest is
   expired, so only one can be paid.
3. The browser goes to Stripe. The card never touches Poolmaster.
4. Stripe sends `checkout.session.completed` with `payment_status: paid`. The webhook (§6)
   records the expansion and the payment in one transaction.
5. The browser comes back to `?expanded=done`. The page shows "Finishing your payment..."
   and refreshes the contest until the new cap shows, usually a second or two. It never
   trusts the query string to grant anything.

**Backstop**: two different commissioners can still pay for the same contest in a race. The
webhook keeps the higher band and refunds the other in full, and emails its payer.

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
- **Unknown leagues, contests and customers.** An event for something this database doesn't
  know is stored, logged and answered 200, so Stripe doesn't retry for three days. On QA this
  is normal after "Reset QA database", because Stripe's test data survives the reset.
- **Fast answer.** The handler does its database work and returns; emails go through the
  outbox as always, never sent inside the webhook.
- **Events in phase 1**: `checkout.session.completed` (and
  `checkout.session.async_payment_succeeded` if a slower payment method is ever enabled),
  `charge.refunded` (removes the expansion, records the refund). Anything else is stored and
  ignored. Phase 2 adds the subscription events and a locked re-read (§17).
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
  "Entry caps change on <date>" (once, about two weeks before the cap is lowered), and
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
  (about $15) and emails you. The webhook treats it like a refund. Rare at these amounts.
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
    admin grant and reason), who bought, when, removed-at for a refund. One current
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

All deferred until Derek's go (2026-10-24), filed under #931.

**Phase 1**

1. **Stripe account and secrets** (#979). You create the Stripe account (test mode is
   enough) and one Price per expansion band; a thread adds the two secrets to Terraform for
   QA and the `BILLING_CONFIG` group, switch off. No behaviour change.
2. **Launch plan setup** (#986). Platinum gets a cap (1000), the default plan becomes Premium,
   existing leagues move to Premium with a renewal date six months out, and Platinum shows as
   "Coming soon" in the picker. The day 1 caps and the features' "starts at" are then set on
   the Plans page by the root admin. Can be built before any payments.
3. **Model** (#980). Expansions, billing, events and payments tables; entitlements combine
   plan and expansion. No behaviour change.
4. **Checkout and webhook** (#981). The `billing` module, expansion checkout, the webhook,
   the daily check, prices route, "Finishing your payment". Switch on in QA.
5. **Commissioner screens and history** (#987). The full notice and Expand choice, payment history
   on league settings and Account, the two emails, root admin payments and grants,
   `docs/PAYMENTS.md` runbook (refunds, disputes, rotating keys).
6. **Going live** (#985). With production (#917) and Terms (#921): live keys and Prices,
   webhook registered, Stripe Tax decision. Expansions stay off in production until you
   decide to lower the cap (§3).

**Phase 2** (subscriptions, Part B): #982, #983, #984, revised when Derek wants them.

## 13. Questions

Each has a recommendation; answer only where you disagree.

**Decided (Derek 2026-10-24):** Stripe; per-contest purchases first on a capped Premium, the
cap 100 on day 1 with payments built and tested but not required;
Platinum capped at 1000 long term; our own payment history with a link to Stripe's receipt;
subscriptions later, annual or monthly with monthly at a premium.

1. **Decided (Derek 2026-10-24): yes**, existing leagues move to Premium too, and every league
   gets a renewal date six months out (§3).
2. **Decided (Derek 2026-10-24): Platinum shown as "Coming soon" and not selectable**; the
   other plans stay in the picker (§3).
3. **Decided (Derek 2026-10-24): yes.** Day 1 caps: Free 20, Pro 50, Premium 100, Platinum
   1000 entries per contest; Premium and Platinum unlimited sports leagues (§3).
4. **Decided (Derek 2026-10-24): yes.** Day 1 in production: payments built but switched off,
   so no prices show; on in QA test mode. Lowering the cap later gets an announced date and
   an email two weeks before.
5. **Decided (Derek 2026-10-24):** bands of 50 entries for $10, 100 for $20, 200 for $30 and
   500 for $40, stepping up for the difference. Amounts can change in Stripe without code.
6. **Decided (Derek 2026-10-24): yes.** Buy any time until the contest stops taking entries.
7. **Decided (Derek 2026-10-24): yes.** The root admin can grant an expansion free, with a
   reason; it shows in the history as $0.
8. **No automatic refunds; you refund case by case in Stripe, which removes the expansion
   but keeps the entries?** Recommended: yes, written into the Terms (#921). In practice: a
   commissioner who wants money back emails you; you open the payment from the root admin
   link and press Refund in Stripe (full or part); Stripe returns the money to the card in
   5 to 10 days and emails a refund receipt; the webhook marks the payment refunded in the
   history and removes the expansion. Entries already in stay, but the contest takes no new
   ones while over its cap. A part refund keeps the expansion. A cancelled contest is not
   refunded automatically; you decide each time. Stripe keeps its fee on a refunded payment
   (about 59¢ on $10).
9. **Decided (Derek 2026-10-24): yes.** Stripe sends receipts; we send only the cap-date
   notice and "contest expanded".
10. **Decided (Derek 2026-10-24):** no sales tax at launch; ask an accountant, turn on
    Stripe Tax when needed.
11. **Prices final before going live, not now?** Recommended: yes. Nothing is needed now:
    test mode uses the bands above, and the live amounts are typed into Stripe when phase 1
    goes live (#985).

## 14. Monetization order (Derek 2026-10-24)

Derek expects the first money to come from per-contest fees, not plans: few will pay around
$200 a year for a plan until they have paid per-contest fees and see they would pay more than
that over a year. So phase 1 sells only expansions, on a capped Premium with every feature,
and phase 2 sells plans. `plans/monetization-strategy.md` carries the same order.

# Part B. Phase 2: subscriptions (later)

Designed and reviewed on PR #967 before the switch to per-contest first; kept here so phase 2
starts from it. Questions on it are parked until phase 2 is picked up: when free Premium
ends for leagues that don't subscribe, what they drop to, grace length, and proration.

## 15. What a league subscribes to

- **One subscription per league, annual or monthly** (Derek 2026-10-24), monthly at a
  premium ($99 a year or $9.99 a month as the example). One Stripe Product per paid plan with
  an annual and a monthly Price; Price ids in `BILLING_CONFIG`.
- **Paid by one commissioner**, the payer, on the league's Stripe customer; every
  commissioner sees the plan, period, payer and next charge; another commissioner can take
  over billing.
- **Long-term caps**: Premium back to 100 entries, Platinum 1000, set on the Plans page.
- **Expansions keep working** on any plan: a contest's cap is the higher of the two.
- **Where it starts**: the plan comparison pages (designed on PR #974), whose
  Yearly / Monthly toggle hands a plan and period to checkout.

## 16. Checkout, changes and hand-over

- **Checkout**: `POST /leagues/:id/billing/checkout { plan, interval }`, `mode: subscription`,
  under the league row lock with one customer per league and earlier open sessions expired,
  as in §5.
- **Who is in charge of the plan**: with a subscription, billing is; the free picker is
  refused with a pointer to the plan page, and the webhook and reconcile set the plan from
  the subscription. Without one, a lower plan is free and a higher one needs checkout. The
  root admin can comp a league; how a comp survives billing (a marker, or a free period
  date that billing respects) is settled with the phase 2 launch rule.
- **Moving up** applies at once with a prorated charge; **moving down** and annual to monthly
  take effect at period end, as a subscription schedule we create and read back.
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
