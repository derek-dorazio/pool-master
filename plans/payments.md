# Payments

**Tracking issue:** #931. Builds on `plans/monetization-strategy.md` (#581, plans epic #943).

Written 2026-10-24 for Derek's review. Design only; nothing here is built or scheduled.
Questions are in §14, each with a recommendation; answer only where you disagree.

## TL;DR

- **Never touch a card.** Use **Stripe**. Commissioners pay on Stripe's own checkout page and
  manage their card, receipts and cancellation on Stripe's own billing page. Poolmaster stores
  only Stripe's ids (customer, subscription) and what the league has paid for. Card numbers
  never reach our servers, so the card-security rules (PCI) shrink to one self-assessment form.
- **One yearly subscription per league**, paid by one of its commissioners. The plan column
  that exists today (`League.plan`) stays the one thing every check reads; payments only
  decide what that column says.
- **Stripe tells us what happened by webhook.** One endpoint, signature checked, each event
  stored once by its id so a repeat does nothing, and every event answered by re-reading the
  subscription from Stripe, so events arriving out of order cannot leave a wrong plan.
- **Launch rule (Derek 2026-10-24):** every league is Platinum free until its renewal date,
  set from its signup date. At renewal, a league nobody paid for moves to **Free** after a
  short grace period, with the hide-never-delete rule that already exists, so paying again
  brings everything back.
- **QA runs Stripe's test mode** (fake cards, no money). Live keys exist only in production.
  Keys live in Secrets Manager through Terraform, like the JWT secret.
- Seven slices, all behind a payments switch that stays off until you turn it on. Before
  live mode: prices, Terms and refund policy (#921), and the production environment (#917).

## 1. How online payments work, in plain terms

A **payment provider** (Stripe, Paddle, PayPal...) is the company that takes the card, talks
to the banks, moves the money to your bank account, and keeps the card on file for next year.
The app never sees the card; it sees "customer cus_123 has an active subscription to price
price_PRO_YEARLY, paid through 2027-10-24".

Three pieces do the work:

1. **Hosted checkout.** When a commissioner clicks "Upgrade to Pro", our server asks Stripe
   for a checkout page for that league and that plan, and sends the browser there. Stripe
   collects the card (and Apple Pay, Google Pay, Link), handles bank checks such as 3-D Secure,
   and sends the browser back to our league page.
2. **Webhooks.** Stripe then calls a URL on our server ("a subscription was created", "an
   invoice was paid", "a payment failed"). This, not the browser coming back, is what changes
   the league's plan: a browser can close, be faked or come back twice; a signed webhook
   cannot.
3. **Customer portal.** A Stripe page where the payer updates the card, sees invoices and
   receipts, and cancels. We link to it; we don't build any of it.

**Subscription** is Stripe's word for "charge this price every year until cancelled". Stripe
renews it, retries a failed card on a schedule, emails the payer when a card fails, and tells
us by webhook how it ended.

## 2. Provider

| | Stripe | Paddle | PayPal / Braintree | Square |
|---|---|---|---|---|
| Fees (US cards, approx., check at build) | 2.9% + 30¢, plus ~0.7% for subscriptions | ~5% + 50¢, all in | ~3.5% + 49¢ (PayPal) | 2.9% + 30¢ online |
| Hosted checkout and billing portal | Yes, both | Yes, both | Checkout yes, portal weak | Checkout yes, subscriptions basic |
| Sales tax and VAT | You are the seller; Stripe Tax can calculate and file for ~0.5% more | Paddle is the seller of record and handles all tax | You | You |
| Developer tools | Best in class: test mode, test cards, signed webhooks, typed Node SDK, CLI | Good | Dated | Fine |
| Fit for a small US-first site | Strong | Strong if tax is the main worry | Weak | Weak |

**Recommendation: Stripe** (Q1). It is the default for a reason: the cheapest per payment at
our sizes, the clearest test mode, and the most examples to follow. Paddle is the one real
alternative: it becomes the legal seller and deals with every sales tax and VAT rule for
you, for roughly 2 points more per payment. That matters once a site sells in many US states
and abroad; at launch, with US leagues and yearly payments of tens of dollars, Stripe plus an
accountant's check (§9) is simpler. Stripe has also been adding a seller-of-record option of
its own; if it is offered to us when we build, it is worth comparing then. Lemon Squeezy is
another seller-of-record service, now owned by Stripe.

Everything below assumes Stripe. The code keeps Stripe behind one module and one interface
(§11), so swapping later is contained, but not free.

## 3. What a league buys

- **One subscription per league, yearly** (Q3). A league is a tenant
  (`rules/domain-model-concepts.md` *A league is a tenant*): its subscription, payer, invoices and
  receipts belong to that league and nothing else. One person paying for two leagues has two
  subscriptions.
- **Stripe customer per league, not per person** (Q5). The customer is "this league's billing
  contact": its email is the payer's, and handing billing to another commissioner is changing
  that contact and card, with the league's invoice history kept in one place. The portal for a
  league then shows only that league's invoices.
- **Who pays**: any commissioner of the league. The one who checks out becomes the **payer**;
  every commissioner sees the plan, the renewal date and who pays; only the payer opens the
  portal; another commissioner can take over (§6).
- **Prices live in Stripe.** One Stripe Product per paid plan (Pro, Premium, Platinum), one
  yearly Price each. Our settings hold only the Price ids per plan (§10); the amount shown on
  screen is read from Stripe, so a price is never typed twice. Free has no price.
- **US dollars only** at launch.
- **Not in this build** (they need payments first, and each is its own decision later):
  per-contest unlocks, the majors pass, trials of a higher plan, credit and referral codes.
  Stripe supports coupons and promotion codes when you want them (Q10).

## 4. The renewal date (launch rule)

Every league needs a **renewal date**: the day its free Platinum ends and paying starts.

- **New column `League.planRenewsAt`** (date). Set when the league is created:
  signup + the free period (Q2: 6 or 12 months; you leaned to 6).
- **Existing leagues** count from the day payments go live, not from their signup, so nobody
  created in the last few months gets a bill a week after hearing about pricing (Q2). The
  migration leaves them empty; turning payments on fills them.
- The root admin can move a league's date (a favour, a dispute, a tester), logged like a plan
  change.
- **Before the date**: reminders to every commissioner at 30, 7 and 1 days (always sent,
  never opt-out: they are about the account, like security emails). Any commissioner can pay
  early; the subscription then starts on the renewal date, so nobody loses free months
  (Stripe can start a subscription's first charge on a future date).
- **At the date, unpaid**: a **14-day grace period** (Q4), Platinum kept, a banner for
  commissioners, then the league moves to **Free**. Everything above Free is hidden, never
  deleted (`plans/monetization-strategy.md` *Moving to a lower plan*), and comes back the
  moment anyone pays.
- **At the date, paid**: Stripe charges the card and the league keeps the plan it paid for.

The "Every plan is free for now" copy and the free plan picker stay exactly as they are while
the payments switch is off.

## 5. Checkout, step by step

1. A commissioner opens league settings, Plan, and picks Pro. The picker shows the price from
   Stripe and the renewal date.
2. The app calls `POST /leagues/:id/billing/checkout { plan }`. The server checks the caller is
   a commissioner and the league has no active subscription (if it has one, it is a plan
   change, §6), creates the league's Stripe customer if needed, and creates a Checkout Session
   with `mode: subscription`, the plan's Price, `client_reference_id` and `metadata` holding
   the league id, and success and cancel URLs back to the league's plan page. Our call carries
   an idempotency key, so a double click makes one session.
3. The browser goes to Stripe. The card never touches Poolmaster.
4. Stripe sends `checkout.session.completed` and `customer.subscription.created`. The webhook
   (§7) records the subscription and moves the league to Pro, logged with source `PAYMENT`.
5. The browser comes back to `?checkout=done`. The page shows "Finishing your payment..."
   and refreshes the league until the plan shows Pro, which is usually a second or two. It
   never trusts the query string to grant anything.

**Two commissioners paying at once.** The server refuses a second checkout while one is
active, but two sessions can still both complete. The webhook keeps the first subscription,
cancels the second with a full refund, and emails its payer. Rare, but money, so handled.

## 6. Changing, cancelling, handing over

- **Moving up** mid-year (Pro to Premium): applies at once, and Stripe charges the prorated
  difference for the rest of the year now (Q6).
- **Moving down** (Premium to Pro, or to Free): takes effect at the end of the paid year, no
  refund; until then the league keeps what it paid for. The plan page says "Moves to Pro on
  2027-04-24".
- **Cancelling**: in the portal, or "Stop renewing" on our plan page. Same as moving to Free at
  the end of the year. Undo is possible until then.
- **The free plan picker** (`PUT /leagues/:id/plan`) changes meaning when payments are on:
  any commissioner may still pick a **lower** plan at any time for free, but a **higher** plan
  than the league has paid for goes through checkout. The root admin can still set any plan
  (comps, testers), logged as `ROOT_ADMIN`.
- **Payer leaves or hands over**: the subscription keeps running on their card until the
  renewal. Any other commissioner can press "Take over billing", which sends them through a
  Stripe setup page for their own card and makes them the payer; the old payer is emailed.
  If the payer leaves the league, every commissioner is told billing needs a new owner before
  the renewal.
- **League deactivated or deleted**: its subscription is cancelled at once, without a refund
  unless you give one (§9).

## 7. Webhooks and idempotency

One public endpoint, `POST /billing/stripe-events`, like the SES events endpoint
(`packages/core-api/src/modules/email/email-events-routes.ts`): no login, the signature is
its whole authority.

- **Signature.** Stripe signs each call with the endpoint's signing secret. The route reads
  the raw body (a module-scoped content type parser, as the SES route does) and checks it with
  the Stripe SDK; a bad or stale signature (older than 5 minutes) gets 400 and changes nothing.
- **Stored once.** Each event's id goes in a `billing_events` table with a unique index, in
  the same transaction as its effect. A repeat (Stripe retries until it gets a 2xx, for up to
  three days) finds the row and answers 200 without doing anything twice.
- **Order-proof.** Stripe does not promise order. So the handler never trusts the event's copy
  of the subscription: it re-reads the subscription from Stripe and applies its current state.
  Ten events in any order end in the same place.
- **Fast answer.** The handler does its database work and returns; emails go through the
  outbox as always, never sent inside the webhook.
- **Events we act on**: `checkout.session.completed`, `customer.subscription.created`,
  `.updated`, `.deleted`, `invoice.paid` (payment history row), `invoice.payment_failed`
  (banner and grace), `charge.refunded` (payment history). Anything else is stored and ignored.
- **Nightly reconcile.** A daily job re-reads every league with a subscription from Stripe and
  fixes any drift, logging what it changed. This covers a webhook lost for longer than Stripe
  retries (an outage on our side).
- **How status maps to the plan**:

| Stripe subscription status | League plan |
|---|---|
| `active`, or `trialing` | the plan of its Price |
| `past_due` (card failing, Stripe retrying) | kept, with a banner for commissioners |
| `canceled`, `unpaid`, `incomplete_expired` | Free (or a lower plan it was moved to at year end) |
| `incomplete` (checkout started, card not confirmed) | unchanged |

  Stripe's retry schedule (Smart Retries, about two weeks) is the grace period for a failing
  card, set in the Stripe dashboard to cancel when retries run out.

## 8. Emails and receipts

- **Receipts and invoices: Stripe's own** (Q9). Stripe emails a receipt for every payment and
  a "your card failed, update it here" email, and keeps every invoice as a PDF in the portal.
  They are correct by construction and legally formatted; we would only be copying them.
  Branding (name, logo, colour) is set in the Stripe dashboard.
- **Ours, through the email outbox** (`plans/email-notifications.md`): "Your free Platinum
  ends in 30 / 7 / 1 days", "Your plan ends on ... unless someone pays", "Your league moved to
  Free", "You're now the payer", "Billing needs a new owner". All in the account category,
  always sent, to commissioners only; members never hear about money. Each is a template with
  `planFeature: null` (always) and its own idempotency key per league and date, so a job
  re-run sends nothing twice.

## 9. Tax, refunds and the paperwork

- **Sales tax.** In the US, whether yearly access to a website is taxable differs by state,
  and you only owe a state once your sales there pass its threshold (commonly $100,000 a
  year). At launch that is very unlikely to apply, but it is a question for an accountant,
  not a design (Q8). Stripe Tax can be switched on later in the dashboard (about 0.5% per
  payment) and then calculates, collects and reports it; checkout just shows a tax line. We
  build so turning it on is a setting, not a code change.
- **Refunds.** No automatic refunds. Cancelling stops the next renewal; the plan runs to the
  end of the paid year (Q7). You refund case by case from the Stripe dashboard (full or part);
  the webhook records it in the payment history, and a full refund also ends the subscription.
  The root admin league page links to the league's Stripe customer.
- **Disputes (chargebacks).** A payer's bank can reverse a payment; Stripe charges a fee
  (about $15) and emails you. The league moves to Free if the subscription ends. Rare at these
  amounts.
- **Before live payments**: Terms of Service with the refund and renewal rules, and a Privacy
  Policy naming Stripe (#921, which is waiting); a Stripe account verified with your business
  details and bank account; the PCI self-assessment (SAQ A, the short one for hosted
  checkout), which Stripe walks you through.

## 10. Test mode on QA, live mode in production

- **QA uses Stripe test mode**: separate keys, no real money, test cards (`4242 4242 4242
  4242` succeeds; others fail, need 3-D Secure, or decline later). You and threads can try
  every path on QA safely. Test clocks in the dashboard fast-forward a subscription a year to
  see a renewal or a failed card without waiting.
- **Production uses live mode**, set up with the production environment (#917, on hold). Live
  keys never exist anywhere else.
- **Per environment, in Secrets Manager via Terraform**: `STRIPE_SECRET_KEY` (a restricted key
  limited to what we call) and `STRIPE_WEBHOOK_SECRET`, wired into the ECS task's `secrets`
  block like `jwt_secret` (`plans/production-environment.md` §6). Values come from
  `TF_VAR_...` at apply time, never committed. Hosted checkout needs no key in the browser.
- **Per environment, in app settings** (a new `BILLING_CONFIG` group, edited on the root admin
  Settings page): `paymentsEnabled` (off until you say), the Stripe Price id per paid plan,
  the free period in months, the grace days. Price ids differ between test and live, so they
  belong to the environment, not the code.
- **The webhook endpoint** is registered in each Stripe mode against that environment's URL
  (QA: `https://qa.ultimateofficepoolmanager.com/api/v1/billing/stripe-events`).
- **Local work** uses the Stripe CLI to forward test events to a laptop.

## 11. How it fits the code

- **A new `billing` module** in `packages/core-api/src/modules/`, the only code that knows
  Stripe exists. Its `BillingProvider` port (create customer, create checkout session, read
  subscription, portal link, cancel, refund) has one Stripe adapter using the official
  `stripe` Node package. Other modules call `BillingService`, never Stripe
  (`rules/architecture-rules.md` §4 *Service Topology*, §5 *Project Structure and Layer
  Boundaries*).
- **The plan column stays the authority.** `BillingService` moves a league's plan through the
  same repository call as `LeaguePlanService`, so `PlanEntitlementsService` and every cap and
  feature check stay exactly as built. Nothing outside billing reads subscription state.
- **Model changes** (`rules/model-change-rules.md`):
  - `League.planRenewsAt` (date, nullable until payments are on).
  - `league_subscriptions`: one row per league (unique), Stripe customer and subscription ids,
    the payer, the plan paid for, a typed status enum mirroring Stripe's, the current period
    end, the plan it moves to at period end, cancel-at-period-end.
  - `billing_events`: Stripe event id (unique), type, received and processed times.
  - `league_payments`: one row per paid or refunded invoice: league, payer, plan, amount,
    currency, period, Stripe invoice id and hosted invoice link. This is the account payment
    history from #931.
  - `league_plan_changes` gains a typed `source`: `COMMISSIONER`, `ROOT_ADMIN`, `PAYMENT`,
    `RENEWAL_LAPSE`, `PAYMENT_ENDED`.
- **Routes**: `POST /leagues/:id/billing/checkout`, `POST /leagues/:id/billing/portal`
  (returns a portal link), `POST /leagues/:id/billing/take-over`, `GET /leagues/:id/billing`
  (plan paid, renewal date, payer, status, payments), `GET /users/me/payments` (what I paid,
  for which league), `POST /billing/stripe-events`. All contract-first with DTOs and the
  generated client (`rules/service-rules.md` §4 *DTOs, Mappers, and OpenAPI*).
- **Screens**: league settings Plan page gains price, renewal date, payer, "Upgrade",
  "Manage billing" and the grace banner; Account gains a Payments list; the root admin league
  page gains billing status, renewal date edit and a Stripe link.
- **Tests** (`rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*): no Stripe
  fakes in app code. Unit and integration tests run against a fake `BillingProvider` defined
  in test code; webhook tests post real signed payloads built with the Stripe SDK's test
  signature helper; a manual QA checklist covers the real test-mode paths (pay, fail, 3-D
  Secure, renew with a test clock, refund, take over). No Stripe network calls in CI.

## 12. Security notes for review

- No card data, ever; only Stripe ids and amounts.
- The webhook trusts nothing but the signature, and re-reads Stripe before acting.
- Checkout and portal routes check the caller is a commissioner of that league; the portal
  route also that they are its payer. A payer's portal shows only that league's customer.
- The Stripe key is restricted to the calls we make; rotating it is a Terraform apply.
- Logs carry league and Stripe ids, never card details or full customer emails
  (`rules/service-rules.md` §11 *Backend Logging Conventions*).

## 13. Slices

Each slice is its own ticket under #931, in order; 3 and 5 can run in parallel after 2.

1. **Stripe account and secrets.** You create the Stripe account (test mode is enough) and
   the three Products and Prices; a thread adds the two secrets to Terraform for QA and the
   `BILLING_CONFIG` group, switch off. No behaviour change.
2. **Model.** Renewal date, subscriptions, events, payments tables, plan change source.
   Migration only; no behaviour change.
3. **Checkout and webhook.** The `billing` module, checkout route, webhook with signature,
   storing once and re-reading, plan moves, "Finishing your payment" page. Switch on in QA.
4. **Manage.** Portal link, moving up and down, stop renewing, take over, payment history on
   league settings and Account, the free picker's new rule.
5. **Renewal and lapse.** Filling renewal dates when the switch turns on, the daily job:
   reminders, grace, move to Free; our emails.
6. **Root admin and reconcile.** Billing on the root admin league page, renewal date edit,
   nightly reconcile, `docs/PAYMENTS.md` runbook (refunds, disputes, rotating keys).
7. **Going live.** With production (#917) and Terms (#921): live keys and Prices in prod,
   webhook registered, Stripe Tax decision, switch on.

## 14. Questions

Each has a recommendation; answer only where you disagree.

1. **Provider: Stripe?** Recommended: yes. Cheapest at our sizes, best test mode and tools.
   Paddle instead only if you would rather pay about 2 points more per payment to never
   think about sales tax.
2. **Free period: 6 months from signup, with existing leagues counted from the day payments
   go live?** Recommended: yes. You leaned to 6; counting existing leagues from launch means
   nobody gets a bill days after first hearing of prices.
3. **Yearly only, no monthly?** Recommended: yes. Pools are seasonal; monthly invites paying
   for one tournament and cancelling. Monthly can be added later as a second Price.
4. **Unpaid at renewal: 14 days' grace, then Free?** Recommended: yes. Free keeps the league
   running and hides, never deletes, so paying later restores everything.
5. **Billing belongs to the league, paid by one commissioner who can hand it over?**
   Recommended: yes. Keeps each league's money separate (leagues are tenants) and survives a
   commissioner leaving.
6. **Moving up charges the prorated difference at once; moving down waits for the end of the
   paid year?** Recommended: yes. Standard, fair, and nobody needs refunds for a downgrade.
7. **No automatic refunds; you refund case by case in Stripe?** Recommended: yes, written into
   the Terms (#921). Cancelling stops the next renewal and keeps the plan to the end of the
   year.
8. **Sales tax: don't collect at launch, ask an accountant, turn on Stripe Tax when needed?**
   Recommended: yes. Thresholds are high and a setting turns it on later; an accountant should
   confirm for your state.
9. **Stripe sends receipts and failed-card emails; we send only plan and renewal emails?**
   Recommended: yes. Stripe's are complete and legally formatted; copying them adds work and
   risk.
10. **Leave per-contest unlocks, the majors pass, trials and promo codes out of this build?**
    Recommended: yes. Each is its own pricing decision; the subscription is what the launch
    rule needs. Stripe promo codes can be switched on in checkout later.
11. **Prices: decide before going live, not now?** Recommended: yes. Building and testing use
    placeholder test-mode prices; the real numbers are set in Stripe before slice 7, with no
    code change.
