# Payments

**Tracking issue:** #931. Builds on `plans/monetization-strategy.md` (#581, plans epic #943).
Per-event purchases: #968.

Written 2026-10-24 for Derek's review; revised the same day after review on PR #967 and
Derek's direction on billing periods and per-event purchases. Design only; nothing here is
built or scheduled. Questions are in §15, each with a recommendation; answer only where you
disagree.

## TL;DR

- **Never touch a card.** Use **Stripe**. Commissioners pay on Stripe's own checkout page and
  manage their card and cancellation on Stripe's own billing page. Poolmaster stores only
  Stripe's ids (customer, subscription) and what the league has paid for. Card numbers never
  reach our servers, so the card-security rules (PCI) shrink to one self-assessment form.
- **One subscription per league, annual or monthly** (Derek 2026-10-24), monthly at a premium
  (for example $99 a year or $9.99 a month). One of the league's commissioners pays. The plan
  column that exists today (`League.plan`) stays the one thing every check reads; payments
  only decide what that column says, under one rule for who is in charge of it (§6).
- **Stripe tells us what happened by webhook.** One endpoint, signature checked, each event
  stored once by its id so a repeat does nothing, and every event answered by re-reading the
  subscription from Stripe and applying it under a row lock, so events arriving out of order
  or at the same moment cannot leave a wrong plan.
- **Launch rule (Derek 2026-10-24):** every league is Platinum free until its renewal date,
  set from its signup date. Paying early never cuts the free period short. At renewal, a
  league nobody paid for moves to **Free** after a short grace period, with the
  hide-never-delete rule that already exists, so paying again brings everything back.
- **Per-event purchases come next, and may make money first** (Derek 2026-10-24): one payment
  to raise one pool's entry cap, designed in #968. This design shares its customer, webhook
  and payment history with them (§12).
- **QA runs Stripe's test mode** (fake cards, no money). Live keys exist only in production.
  Keys live in Secrets Manager through Terraform, like the JWT secret.
- Seven slices, all behind a payments switch that stays off until you turn it on. Before
  live mode: prices, Terms and refund policy (#921), and the production environment (#917).

## 1. How online payments work, in plain terms

A **payment provider** (Stripe, Paddle, PayPal...) is the company that takes the card, talks
to the banks, moves the money to your bank account, and keeps the card on file for next time.
The app never sees the card; it sees "customer cus_123 has an active subscription to price
price_PRO_ANNUAL, paid through 2027-10-24".

Three pieces do the work:

1. **Hosted checkout.** When a commissioner clicks a plan, our server asks Stripe for a
   checkout page for that league and that plan, and sends the browser there. Stripe collects
   the card (and Apple Pay, Google Pay, Link), handles bank checks such as 3-D Secure, and
   sends the browser back to our league page.
2. **Webhooks.** Stripe then calls a URL on our server ("a subscription was created", "an
   invoice was paid", "a payment failed"). This, not the browser coming back, is what changes
   the league's plan: a browser can close, be faked or come back twice; a signed webhook
   cannot.
3. **Customer portal.** A Stripe page where the payer updates the card and cancels. We link to
   it; we don't build any of it.

**Subscription** is Stripe's word for "charge this price every month or year until
cancelled". Stripe renews it, retries a failed card on a schedule, emails the payer when a
card fails, and tells us by webhook how it ended.

## 2. Provider

| | Stripe | Paddle | PayPal / Braintree | Square |
|---|---|---|---|---|
| Fees (US cards, approx., check at build) | 2.9% + 30¢, plus ~0.7% for subscriptions | ~5% + 50¢, all in | ~3.5% + 49¢ (PayPal) | 2.9% + 30¢ online |
| Hosted checkout and billing portal | Yes, both | Yes, both | Checkout yes, portal weak | Checkout yes, subscriptions basic |
| One-time payments too (per-event, #968) | Yes, same checkout | Yes | Yes | Yes |
| Sales tax and VAT | You are the seller; Stripe Tax can calculate and file for ~0.5% more | Paddle is the seller of record and handles all tax | You | You |
| Developer tools | Best in class: test mode, test cards, signed webhooks, typed Node SDK, CLI | Good | Dated | Fine |
| Fit for a small US-first site | Strong | Strong if tax is the main worry | Weak | Weak |

**Recommendation: Stripe** (Q1). It is the default for a reason: the cheapest per payment at
our sizes, the clearest test mode, and the most examples to follow. Paddle is the one real
alternative: it becomes the legal seller and deals with every sales tax and VAT rule for
you, for roughly 2 points more per payment. That matters once a site sells in many US states
and abroad; at launch, with US leagues and payments of $10 to a few hundred dollars, Stripe
plus an accountant's check (§10) is simpler. The fixed 30¢ matters most on small per-event
payments: on $10 Stripe keeps about 59¢, Paddle about $1. Stripe has also been adding a
seller-of-record option of its own; if it is offered to us when we build, it is worth
comparing then. Lemon Squeezy is another seller-of-record service, now owned by Stripe.

Everything below assumes Stripe. The code keeps Stripe behind one module and one interface
(§12), so swapping later is contained, but not free.

## 3. What a league buys

- **One subscription per league, annual or monthly** (Derek 2026-10-24). A league is a
  tenant (`rules/domain-model-concepts.md` *A league is a tenant*): its subscription, payer,
  invoices and receipts belong to that league and nothing else. One person paying for two
  leagues has two subscriptions.
- **Monthly costs more than annual** (Derek 2026-10-24): his example is $99 a year or $9.99
  a month, about 20% more over a year. A league can switch between them; the switch applies
  at the end of the current period.
- **Stripe customer per league, not per person** (Q5). The customer is "this league's billing
  contact": its email is the payer's, and handing billing to another commissioner changes
  that contact and card (§7). Our own payment history, not Stripe's portal, shows a league's
  past payments, so no payer sees another's card or address.
- **Who pays**: any commissioner of the league. The one who checks out becomes the **payer**;
  every commissioner sees the plan, the renewal date and who pays; only the payer opens the
  portal; another commissioner can take over (§7).
- **Where it starts**: the plan comparison page for commissioners (designed in its own
  thread). Clicking a plan there leads into checkout (§5) or, for a league already paying, a
  plan change (§7).
- **Prices live in Stripe.** One Stripe Product per paid plan (Pro, Premium, Platinum), with
  an annual and a monthly Price each. Our settings hold only the Price ids (§11); the amount
  shown on screen is read from Stripe, so a price is never typed twice. Free has no price.
- **US dollars only** at launch.
- **Not in this build**: per-event purchases (#968, next, §12), the majors pass, trials of a
  higher plan, credit and referral codes. Stripe coupons and promotion codes can be switched on
  in checkout later (Q10).

## 4. The renewal date (launch rule)

Every league needs a **renewal date**: the day its free Platinum ends and paying starts.

- **New column `League.planRenewsAt`** (date). Set when the league is created:
  signup + the free period (Q2: 6 or 12 months; you leaned to 6).
- **Existing leagues** count from the day payments go live, not from their signup, so nobody
  created in the last few months gets a bill a week after hearing about pricing (Q2). That
  day is stored once as `paymentsLiveAt` in the billing settings (§11). The migration leaves
  existing leagues' dates empty; the daily billing job fills every empty date from
  `paymentsLiveAt` while payments are on. Running it twice gives the same dates, and
  switching payments off and on again changes nothing.
- **Moving the date** is how the root admin gives a league free time: a favour, a dispute, a
  tester, a comp (§6). Logged like a plan change.
- **Before the date**: reminders to every commissioner at 30, 7 and 1 days (always sent,
  never opt-out: they are about the account, like security emails).
- **Paying early never shortens the free period.** A commissioner who pays before the date
  gets a subscription whose first charge is on the renewal date (in Stripe, a trial that ends
  then, so the subscription shows as `trialing`). Until the date the league **stays on
  Platinum**; the subscription only records what it moves to on that date, and the plan page
  says "Moves to Pro on 2027-04-24, paid by Sam". On the date, the daily job applies the paid
  plan.
- **At the date, paid**: Stripe charges the card and the league is on the plan it paid for.
  If that first charge fails, the subscription goes `past_due` and Stripe's card retries
  (about two weeks) are the grace period, the same as any later failed renewal (§8). The
  league keeps Platinum until the retries run out, then moves to Free.
- **At the date, unpaid** (no subscription at all): a **14-day grace period** (Q4), Platinum
  kept, a banner for commissioners, then the league moves to **Free**. Everything above Free
  is hidden, never deleted (`plans/monetization-strategy.md` *Moving to a lower plan*), and
  comes back the moment anyone pays. One grace or the other applies, never both.

The "Every plan is free for now" copy and the free plan picker stay exactly as they are while
the payments switch is off.

## 5. Checkout, step by step

1. A commissioner opens the plan comparison page, picks Pro and annual. It shows the price
   from Stripe and the renewal date.
2. The app calls `POST /leagues/:id/billing/checkout { plan, interval }`. Under the league's
   row lock, the server checks the caller is a commissioner and the league has no active
   subscription (if it has one, it is a plan change, §7). It creates the league's Stripe
   customer if there is none yet, with a Stripe idempotency key made from the league id, and
   stores its id before going on, so two checkouts at once still make one customer.
3. It creates a Checkout Session with `mode: subscription`, the Price, `client_reference_id`
   and `metadata` holding the league id, and success and cancel URLs back to the league's plan
   page. It stores the session id on the league's billing row and **expires any earlier open
   session** for the league, so only one can ever be paid. A double click reuses the same
   session through its idempotency key.
4. The browser goes to Stripe. The card never touches Poolmaster.
5. Stripe sends `checkout.session.completed` and `customer.subscription.created`. The webhook
   (§8) records the subscription and, after the renewal date, moves the league to Pro, logged
   with source `PAYMENT`. Before the renewal date it records "moves to Pro" (§4).
6. The browser comes back to `?checkout=done`. The page shows "Finishing your payment..."
   and refreshes the league until the payment shows, which is usually a second or two. It
   never trusts the query string to grant anything.

**Backstop**: if two subscriptions ever exist for one league anyway, the webhook keeps the
first, cancels the second with a full refund, and emails its payer.

## 6. Who is in charge of the plan

Four things can change `League.plan`: a commissioner's pick, the root admin, the billing
webhook and reconcile, and the daily renewal job. One rule decides which is in charge, by
the league's billing state:

| League's state | In charge | Commissioner's plan pick | Billing webhook and jobs |
|---|---|---|---|
| Payments switch off | Commissioners | Any plan, free, as today | Do nothing |
| Before its renewal date (free period, or a comp) | Commissioners | Any plan, free, up or down, including back to Platinum | Record a paid plan for the renewal date; never change the plan now |
| After the date, with a subscription | Billing | Goes through billing: up applies now with a prorated charge, down is scheduled for period end (§7) | Set the plan from the subscription |
| After the date, no subscription (on Free, or in grace) | Billing | Lower: free, at once. Higher: checkout | Grace then Free; payment sets the plan |

- `PUT /leagues/:id/plan` (the free picker) follows the table: after the renewal date, a
  higher plan without payment, or any change while a subscription exists, is refused with a
  409 that points to the plan page, which offers checkout or the plan change instead.
- **Comps are a moved renewal date.** The root admin gives a league a free plan by moving its
  renewal date out (and cancelling any subscription first, which the root admin page offers).
  The league is then "before its renewal date" again: commissioners pick freely and billing
  touches nothing until the new date. No separate comp marker for billing to forget.
- The root admin can still set any plan at any time, logged as `ROOT_ADMIN`; after the
  renewal date, billing may later set it again from the subscription, which the root admin
  page says next to the picker.
- Races between any two of these are already handled: `LeagueRepository.changePlan` checks the
  plan it changes from, and a conflict is a 409 `LEAGUE_PLAN_CHANGED`.

## 7. Changing, cancelling, handing over

- **Moving up** (Pro to Premium): applies at once, and Stripe charges the prorated difference
  for the rest of the period now (Q6).
- **Moving down** (Premium to Pro, or annual to monthly): takes effect at the end of the
  current period, no refund; until then the league keeps what it paid for. The plan page says
  "Moves to Pro on 2027-04-24". In Stripe this is a **subscription schedule**, so re-reading a
  subscription also reads its schedule to know the next plan.
- **Plan changes happen on our plan page only.** The Customer Portal is configured for card
  updates and cancelling; switching plans and invoice history are turned off there, so every
  plan change goes through the rules in §6.
- **Cancelling**: in the portal, or "Stop renewing" on our plan page. Same as moving to Free at
  the end of the period. Undo is possible until then.
- **Payer leaves or hands over**: the subscription keeps running on their card until the
  period ends. Any other commissioner can press "Take over billing", which sends them through
  a Stripe setup page for their own card. When it completes, the server:
  1. sets the new card as the subscription's default payment method,
  2. detaches the old payer's saved cards from the customer,
  3. changes the customer's name, email and address to the new payer's,
  4. records the new payer and emails the old one.

  The new payer never sees the old payer's card, and since invoice history is off in the
  portal, never sees invoices addressed to the old payer either. Our payment history lists
  every payment for the league (date, plan, amount, who paid) to all its commissioners, and
  links each Stripe invoice only for the commissioner who paid it.
  If the payer leaves the league, every commissioner is told billing needs a new owner before
  the period ends.
- **League deactivated or deleted**: its subscription is cancelled at once, without a refund
  unless you give one (§10).

## 8. Webhooks and idempotency

One public endpoint, `POST /billing/stripe-events`, with no login: the signature is its whole
authority, like the SES events endpoint.

- **Raw body.** Stripe checks the signature against the exact bytes it sent, so the body must
  not be parsed first. Stripe sends `application/json`; inside the billing module's own
  Fastify scope, the route removes the JSON parser (`removeContentTypeParser`) and adds one
  with `parseAs: 'buffer'`. Fastify keeps that change inside the module. A test proves the
  rest of the API still parses JSON normally. (The SES route is different: it parses
  `text/plain` as JSON and keeps no raw bytes, so it is not the pattern to copy.)
- **Signature.** The Stripe SDK checks the raw body against the endpoint's signing secret; a
  bad or stale signature (older than 5 minutes) gets 400 and changes nothing.
- **Pinned API version.** The Stripe API version is pinned in the SDK client and on the
  webhook endpoint, so event shapes match the typed SDK. Upgrading it is a deliberate change.
- **Read, then apply under a lock.** For an event about a subscription, the handler first
  re-reads the subscription and its schedule from Stripe, outside any database transaction,
  noting when it read them. Then, in one transaction, it locks the league's billing row
  (`SELECT ... FOR UPDATE`) and writes only if its read is newer than the one stored
  (`lastSyncedAt`). So two events handled at once, say `customer.subscription.updated` and
  `invoice.paid`, cannot let the older read win, and no transaction waits on a network call.
  Never trusting the event's own copy also makes order irrelevant.
- **Stored once, with its effect.** The event id goes in a `billing_events` table with a
  unique index, in the same transaction as the effect. A repeat (Stripe retries until it gets
  a 2xx, for up to three days) finds the row and answers 200 without doing anything twice. If
  anything fails, the event row rolls back with the effect and the handler answers 500 so
  Stripe retries. The id is never stored first and processed later, which would lose the
  effect on a crash.
- **Unknown leagues and customers.** An event for a league or customer this database doesn't
  know is stored, logged and answered 200, so Stripe doesn't retry for three days. On QA this
  is normal after "Reset QA database", because Stripe's test data survives the reset.
  Reconcile skips those subscriptions too.
- **Fast answer.** The handler does its database work and returns; emails go through the
  outbox as always, never sent inside the webhook.
- **Events we act on**: `checkout.session.completed`, `customer.subscription.created`,
  `.updated`, `.deleted`, `subscription_schedule.updated`, `invoice.paid` (payment history),
  `invoice.payment_failed` (banner), `charge.refunded` (payment history). Anything else is
  stored and ignored.
- **Nightly reconcile.** The daily billing job also re-reads every league with a subscription
  from Stripe and fixes any drift through the same locked apply, logging what it changed.
  This covers a webhook lost for longer than Stripe retries (an outage on our side).
- **How a subscription's status maps to the plan**, after the league's renewal date (before
  it, the league stays on Platinum and the subscription only records the next plan, §4):

| Stripe subscription status | League plan |
|---|---|
| `active` | the plan of its Price |
| `trialing` | (only before the renewal date) unchanged; the paid plan is recorded for the date |
| `past_due` (card failing, Stripe retrying) | kept, with a banner for commissioners |
| `canceled`, `unpaid`, `incomplete_expired` | Free (or the lower plan scheduled for period end) |
| `incomplete` (checkout started, card not confirmed) | unchanged |

  Stripe's card retries (Smart Retries, about two weeks) are the grace period for a failing
  card, set in the Stripe dashboard to cancel when retries run out.

## 9. Emails and receipts

- **Receipts: Stripe's own** (Q9). Stripe emails a receipt for every payment and a "your card
  failed, update it here" email. They are correct by construction and legally formatted; we
  would only be copying them. Branding (name, logo, colour) is set in the Stripe dashboard.
- **Ours, through the email outbox** (`plans/email-notifications.md`): "Your free Platinum
  ends in 30 / 7 / 1 days", "Your plan ends on ... unless someone pays", "Your league moved to
  Free", "You're now the payer", "Billing needs a new owner". All in the account category,
  always sent, to commissioners only; members never hear about money. Each is a template with
  `planFeature: null` (always) and its own idempotency key per league and date, so a job
  re-run sends nothing twice.

## 10. Tax, refunds and the paperwork

- **Sales tax.** In the US, whether access to a website is taxable differs by state, and you
  only owe a state once your sales there pass its threshold (commonly $100,000 a year). At
  launch that is very unlikely to apply, but it is a question for an accountant, not a
  design (Q8). Stripe Tax can be switched on later in the dashboard (about 0.5% per payment)
  and then calculates, collects and reports it; checkout just shows a tax line. We build so
  turning it on is a setting, not a code change.
- **Refunds.** No automatic refunds. Cancelling stops the next renewal; the plan runs to the
  end of the paid period. You refund case by case from the Stripe dashboard (full or part);
  the webhook records it in the payment history, and a full refund also ends the subscription.
  The root admin league page links to the league's Stripe customer.
- **Disputes (chargebacks).** A payer's bank can reverse a payment; Stripe charges a fee
  (about $15) and emails you. The league moves to Free if the subscription ends. Rare at these
  amounts.
- **Before live payments**: Terms of Service with the refund and renewal rules, and a Privacy
  Policy naming Stripe (#921, which is waiting); a Stripe account verified with your business
  details and bank account; the PCI self-assessment (SAQ A, the short one for hosted
  checkout), which Stripe walks you through.

## 11. Test mode on QA, live mode in production

- **QA uses Stripe test mode**: separate keys, no real money, test cards (`4242 4242 4242
  4242` succeeds; others fail, need 3-D Secure, or decline later). You and threads can try
  every path on QA safely. Test clocks in the dashboard fast-forward a subscription a month
  or a year to see a renewal or a failed card without waiting.
- **Production uses live mode**, set up with the production environment (#917, on hold). Live
  keys never exist anywhere else.
- **Per environment, in Secrets Manager via Terraform**: `STRIPE_SECRET_KEY` (a restricted key
  limited to what we call) and `STRIPE_WEBHOOK_SECRET`, wired into the ECS task's `secrets`
  block like `jwt_secret` (`plans/production-environment.md` §6). Values come from
  `TF_VAR_...` at apply time, never committed. Hosted checkout needs no key in the browser.
- **Per environment, in app settings** (a new `BILLING_CONFIG` group, edited on the root admin
  Settings page): `paymentsEnabled` (off until you say), `paymentsLiveAt` (the go-live date
  existing leagues count from, §4), the Stripe Price ids per paid plan and billing period,
  the free period in months, the grace days. Price ids differ between test and live, so they
  belong to the environment, not the code.
- **The webhook endpoint** is registered in each Stripe mode against that environment's URL
  (QA: `https://qa.ultimateofficepoolmanager.com/api/v1/billing/stripe-events`).
- **Local work** uses the Stripe CLI to forward test events to a laptop.

## 12. How it fits the code

- **A new `billing` module** in `packages/core-api/src/modules/`, the only code that knows
  Stripe exists. Its `BillingProvider` port (create customer, create and expire checkout
  sessions, read subscription and schedule, portal link, change and cancel, refund, detach
  payment methods) has one Stripe adapter using the official `stripe` Node package. Other
  modules call `BillingService`, never Stripe (`rules/architecture-rules.md` §4 *Service
  Topology*, §5 *Project Structure and Layer Boundaries*).
- **The plan column stays the authority.** `BillingService` moves a league's plan through the
  same repository call as `LeaguePlanService`, so `PlanEntitlementsService` and every cap and
  feature check stay exactly as built. Nothing outside billing reads subscription state.
- **Room for per-event purchases (#968).** A per-event purchase is a one-time Checkout
  Session (`mode: payment`) on the same league customer, through the same webhook and event
  table, landing in the same payment history with a typed kind. Its effect, a raised cap on
  one contest, would be a contest-level unlock that `PlanEntitlementsService` combines with
  the league's plan (a contest gets whichever is better), keeping it the only place that
  decides caps. Nothing in this build has to change for it; the payment history and the
  checkout route are named for billing, not only for subscriptions.
- **Model changes** (`rules/model-change-rules.md`):
  - `League.planRenewsAt` (date, empty until the daily job fills it).
  - `league_billing`: one row per league (unique): Stripe customer id, the payer, the open
    Checkout Session id, the subscription id, the plan and billing period paid for, a typed
    status enum mirroring Stripe's, the current period end, the plan it moves to next and
    when, cancel-at-period-end, and `lastSyncedAt`.
  - `billing_events`: Stripe event id (unique), type, received and processed times, and
    whether its league was unknown.
  - `league_payments`: one row per paid or refunded payment: league, payer, a typed kind
    (`SUBSCRIPTION` now, a contest unlock later), plan, amount, currency, period, Stripe
    invoice or payment id and invoice link. This is the account payment history from #931.
  - `league_plan_changes` gains a typed `source`: `COMMISSIONER`, `ROOT_ADMIN`, `PAYMENT`,
    `RENEWAL_LAPSE`, `PAYMENT_ENDED`.
- **Routes**: `POST /leagues/:id/billing/checkout`, `POST /leagues/:id/billing/plan-change`,
  `POST /leagues/:id/billing/portal` (returns a portal link),
  `POST /leagues/:id/billing/take-over`, `GET /leagues/:id/billing` (plan paid, renewal date,
  payer, status, next plan, payments), `GET /users/me/payments` (what I paid, for which
  league), `GET /billing/prices` (public, so the marketing page can use it too: each paid
  plan's annual and monthly amount, read from Stripe and cached briefly; empty while payments
  are off), `POST /billing/stripe-events`. All contract-first with DTOs and the generated
  client (`rules/service-rules.md` §4 *DTOs, Mappers, and OpenAPI*).
- **Screens**: the commissioner plan comparison page (its own thread) links each plan into
  checkout or a plan change; league settings Plan gains price, period, renewal date, payer,
  next plan, "Manage card", "Take over billing" and the grace banner; Account gains a Payments
  list; the root admin league page gains billing status, renewal date edit, comp and a Stripe
  link.
- **Tests** (`rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*): no Stripe
  fakes in app code. Unit and integration tests run against a fake `BillingProvider` defined
  in test code; webhook tests post real signed payloads built with the Stripe SDK's test
  signature helper, including two events applied at once and an unknown league; a manual QA
  checklist covers the real test-mode paths (pay, pay early, fail, 3-D Secure, renew with a
  test clock, monthly and annual, refund, take over). No Stripe network calls in CI.

## 13. Security notes for review

- No card data, ever; only Stripe ids and amounts.
- The webhook trusts nothing but the signature, and re-reads Stripe before acting.
- Checkout, plan change and portal routes check the caller is a commissioner of that league;
  the portal route also that they are its payer. A hand-over removes the old payer's cards
  and contact details from the customer.
- The Stripe key is restricted to the calls we make; rotating it is a Terraform apply.
- Logs carry league and Stripe ids, never card details or full customer emails
  (`rules/service-rules.md` §11 *Backend Logging Conventions*).

## 14. Slices

Each slice is its own ticket under #931, in order; 3 and 5 can run in parallel after 2.

1. **Stripe account and secrets.** You create the Stripe account (test mode is enough) and
   the three Products with an annual and a monthly Price each; a thread adds the two secrets
   to Terraform for QA and the `BILLING_CONFIG` group, switch off. No behaviour change.
2. **Model.** Renewal date, billing, events and payments tables, plan change source.
   Migration only; no behaviour change.
3. **Checkout and webhook.** The `billing` module, checkout route, webhook with raw body,
   signature, locked apply and storing once, plan moves, "Finishing your payment" page, the
   §6 rule in the free picker. Switch on in QA. Until slice 5 fills renewal dates, every QA
   league counts as past its renewal date, so a higher plan needs checkout there: expected,
   not a bug.
4. **Manage.** Plan changes (up now, down scheduled), annual and monthly switching, stop
   renewing, portal link, take over, payment history on league settings and Account.
5. **Renewal and lapse.** The daily billing job: fill renewal dates from `paymentsLiveAt`,
   reminders, paying early, grace, move to Free; our emails.
6. **Root admin and reconcile.** Billing on the root admin league page, renewal date edit and
   comps, nightly reconcile, `docs/PAYMENTS.md` runbook (refunds, disputes, rotating keys).
7. **Going live.** With production (#917) and Terms (#921): live keys and Prices in prod,
   webhook registered, Stripe Tax decision, switch on.

Per-event purchases (#968) are designed after this and reuse slices 1 to 3. If they are the
first thing to sell, as Derek expects (§16), they could go live before the subscription
slices 4 to 6.

## 15. Questions

Numbered as first sent to Derek; each has a recommendation; answer only where you disagree.

1. **Provider: Stripe?** Recommended: yes. Cheapest at our sizes, best test mode and tools,
   and the same checkout handles one-time per-event payments. Paddle instead only if you
   would rather pay about 2 points more per payment to never think about sales tax.
2. **Free period: 6 months from signup, with existing leagues counted from the day payments
   go live?** Recommended: yes. You leaned to 6; counting existing leagues from launch means
   nobody gets a bill days after first hearing of prices.
3. ~~Yearly only, no monthly?~~ **Decided (Derek 2026-10-24): annual and monthly**, monthly
   at a premium ($99 a year or $9.99 a month as the example).
4. **Unpaid at renewal: 14 days' grace, then Free?** Recommended: yes. Free keeps the league
   running and hides, never deletes, so paying later restores everything.
5. **Billing belongs to the league, paid by one commissioner who can hand it over?**
   Recommended: yes. Keeps each league's money separate (leagues are tenants) and survives a
   commissioner leaving.
6. **Moving up charges the prorated difference at once; moving down waits for the end of the
   paid period?** Recommended: yes. Standard, fair, and nobody needs refunds for a downgrade.
7. **No automatic refunds; you refund case by case in Stripe?** Recommended: yes, written
   into the Terms (#921). Cancelling stops the next renewal and keeps the plan to the end of
   the period.
8. **Sales tax: don't collect at launch, ask an accountant, turn on Stripe Tax when needed?**
   Recommended: yes. Thresholds are high and a setting turns it on later; an accountant should
   confirm for your state.
9. **Stripe sends receipts and failed-card emails; we send only plan and renewal emails?**
   Recommended: yes. Stripe's are complete and legally formatted; copying them adds work and
   risk.
10. **Leave the majors pass, trials and promo codes out of this build?** Recommended: yes.
    **Per-event purchases: decided (Derek 2026-10-24)**, designed next in #968 (§16).
11. **Prices: decide before going live, not now?** Recommended: yes. Building and testing use
    test-mode prices like your $99 / $9.99 example; the real numbers are set in Stripe before
    slice 7, with no code change.

## 16. Monetization order (Derek 2026-10-24)

Derek expects the first money to come from **Free plus per-event fees**, not plans: someday
Free allows 10 entries per pool, and $10 expands one pool. Few will pay around $200 a year for
Platinum until they have paid per-event fees and see they would pay more than that over a
year. Plan subscriptions are designed first (this document) because per-event purchases reuse
all of their plumbing; per-event purchases are designed next in #968, with no advanced
features, only raised caps. `plans/monetization-strategy.md` carries the same order.
