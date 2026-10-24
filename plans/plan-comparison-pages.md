# Plan comparison pages

**Tracking issue:** #969. Parent: #581. Payments: #931 (`plans/payments.md`). Per-event
pricing: #968.

Written 2026-10-24 for Derek's review; every question in *Questions* answered the same day. Mockups:
https://claude.ai/artifact/Gq7nPayxt7J7fE5vth7sCH (public page, commissioner page, phone,
and what choosing a plan does).

## What we are building

Derek's brief (2026-10-24): a commissioner page and a public marketing page that compare the
plans, define each plan and highlight what it includes, with items lined up side by side, and
with caps such as entries per contest driven from the config. For commissioners, clicking a
plan leads into the payment and renewal flow.

Two pages, one comparison:

1. **Public plans page**, `/plans`, open to anyone: what each plan is, its price, what it adds,
   the full comparison table, a few questions, and sign-up buttons.
2. **Commissioner Plan page**, in league settings: the same cards and table, plus the league's
   current plan and usage, and a button on every other plan that moves the league there. It
   replaces today's Choose a plan form at `/league/:code/admin/plan/edit` (#957).

Both are built from the same pieces in `clients/poolmaster/src/features/plans/`: the plan
cards, the comparison table (`plan-comparison.ts` already builds its rows), and the copy in
`plan-labels.ts`. Payments, the yearly prices, and per-event purchases are
designed elsewhere (*Out of scope*).

## What comes from config, what is copy

| On screen | Comes from | Changes when |
|---|---|---|
| Entries per contest, sports leagues a year, per plan | `GET /plans` (PLAN_CONFIG caps) | A root admin saves `/manage/plans` |
| Which plan has each feature (every tick and dash) | `GET /plans` (PLAN_CONFIG starts-at) | Same |
| Each plan's highlight list | Built from the two rows above | Same |
| Plan names, taglines, feature names and one-line descriptions, group names, questions | `plan-labels.ts` and the page (UI copy) | A code change |
| "In every plan" rows (members, contest types, leaderboards, results) | The page (UI copy) | A code change |
| Each plan's expansion prices, and its annual fee in phase 2 | `BILLING_CONFIG` (`plans/payments.md` §9), served by the public `GET /billing/prices` | A root admin saves the billing settings |
| Whether buttons buy or change for free | `paymentsEnabled` in `BILLING_CONFIG` | Same |
| The gift: its length, and a league's end date | The plan settings and `League.planRenewsAt` (#986) | A root admin extends the gift |

Nothing on either page compares plan names: the rows are built from what the API says each
plan has, as the current table is, so moving a feature to another plan on `/manage/plans`
moves its tick on both pages and its line in the highlights with no deploy
(`rules/architecture-rules.md` §2 *Contract-First API Architecture*).

## Lining things up

- **Cards**: four columns of the same height, each with the same rows in the same order:
  name, tagline, price, button, then "Everything in Pro, plus" and the highlights. On a phone
  they stack.
- **Highlights**, built per plan: its cap values that differ from the plan below ("Up to 50
  entries per contest", "3 sports leagues a year"), then the features that start at this plan.
  Free has no plan below, so its card lists its caps, "Every contest type", and the features it
  has.
  When three or more features of one group start at the same plan they show as one line with a
  count ("7 more emails"), so a card never turns into a list of email names (Q3). The mockup's
  hand-written lines show the shape, not final wording.
- **Table**: one column per plan, one row per item, under group headings: Limits, In every
  plan, then each feature group (Emails, Championships, History) with every feature as its own
  row. The first column stays put while the table scrolls sideways; the header row names each
  plan and its price. A group can be collapsed to one summary row showing how many of its items
  each plan has ("4 of 11", "11 of 11"); on the public page Emails starts collapsed because it
  has eleven rows, on the commissioner page everything starts open.
- **Phone**: all four columns stay, with the full plan names and ticks, which fit a 390 px
  screen with no sideways scroll; the one-line descriptions drop to keep rows short.

## Public plans page

Route `/plans`, outside the sign-in guard, like How to Play. Sections, top to bottom:

1. Header with How to Play, **Plans**, Sign in and Start free.
2. Heading, one line on what every plan includes, and the gift pill (Derek 2026-10-24):
   "Every new league gets Premium free for a 6-month preview period", the length read from
   config, never a "trial" or a countdown. It replaces "Every plan is free for now".
3. The four plan cards.
4. **Compare every plan**: the table, each row with its one-line description (Q6).
5. A few questions: who chooses the plan, what happens on a lower plan, no member limit, what a
   sports league is.
6. A closing Start free band.

Linked from the signed-out header, the landing page and the foot of How to Play.

**The API**: `GET /api/v1/plans` needs a session today. It holds nothing about any league or
user, so it joins the public routes beside the contest templates and sport league list that
How to Play reads (`packages/core-api/src/plugins/auth-guard.ts`); its route description says
so (Q1).

**Buttons follow `paymentsEnabled`**: every new league starts on gifted Premium, so a button
that says "Start with Pro" would promise something the app does not do. Every button says
**Start free** and goes to sign-up (Q9). Per-plan buttons wait for annual plans (phase 2 of
`plans/payments.md`). A signed-in visitor sees **Choose for a league**: straight to the Plan page when they
commission one league, otherwise My leagues (Q10).

## Commissioner Plan page

Route `/league/:code/admin/plan`, commissioners and root admins only; the old `plan/edit`
path redirects to it. Linked from the Plan row on league settings and from every "Your plan
allows ..." note commissioners see when a cap or a locked feature stops them (#947, #948).

1. **Your league now**: current plan, sports leagues this year ("2 of 3", with their names),
   and the biggest open contest ("34 of 50 entries", with its name) (Q8). "Open" means still
   taking entries; its entries are counted the way the entry cap counts them (#947), drafts
   included.
2. **Plan cards**: the current one marked **Your plan**; every other one has a button,
   **Move up to Premium** above the current plan and **Move to Pro** below it.
3. **Confirm**, inline above the cards, before anything changes:
   - While `paymentsEnabled` is off: "Plan changes are free while payments are off, so this
     takes effect at once and costs nothing." On a gifted league, moving down ends nothing:
     the gift date stays, and the page says so.
   - For a lower plan, a warning for each cap the league is already over. The entries warning
     names every open contest over the lower cap, up to three and then "and 2 more" ("Masters
     Tiers Pool has 34 entries. On Free it keeps them all, but takes no new entries past 20.");
     the sports leagues warning names this year's sports leagues. Then the
     list of features that will be hidden, and come back as they were on moving up. These
     follow *Moving to a lower plan* in `plans/monetization-strategy.md`.
   - **Move to Pro** saves through the existing `PUT /leagues/:id/plan`; **Keep Platinum**
     closes it.
4. **Compare plans**: the table, the current plan's column shaded. Under each cap the league is
   over on a lower plan, a red "You use 34", so a commissioner sees what a lower plan would
   stop before choosing it.
5. The existing note: a lower plan stops new things and never removes anything.

Members never reach this page and never see a plan name, as now.

### Gift copy

The current plan card on a gifted league reads "Premium gifted for your preview period, until
24 Apr 2027" (Derek 2026-10-24: present the gift as a preview period) from
`League.planRenewsAt`, with one line on what happens then: the league moves to Free, keeps
everything it has, and can expand any contest. Never punitive: no countdown, no "you will
lose", no red. The 30 / 7 / 1 day emails are payments' (§3), not this page's.

### Choosing a plan once annual plans exist

Phase 2 of `plans/payments.md` (§15, §16) decides what each button does once a league can pay
for a year; this page only hands over. Until then every change on this page is the free
`PUT /leagues/:id/plan`.

## Pricing model (Derek 2026-10-24, `plans/payments.md`)

This supersedes the yearly/monthly parts of this doc, Q2's toggle included.

- **Annual only**, no monthly at first: there is no Yearly/Monthly toggle, and annual plans
  come in phase 2. Until then the cards show the lowest plan at $0 and "Free for now" on the others.
- **Prices come from config**: each plan's expansion price list and, in phase 2, its annual
  fee live in `BILLING_CONFIG` (`plans/payments.md` §9), read through the public
  `GET /billing/prices`, never typed in the UI.
- **Each plan's card lists its expansion prices** ("Expand a contest to 200 entries: $15"),
  from that list, so a visitor sees that a higher plan expands for less. While
  `paymentsEnabled` is off, expanding is free and the card says so instead of a price.
- **Caps** come from PLAN_CONFIG as before (the numbers Derek set: 20 / 50 / 100 / 500 entries
  per contest, 5 / 15 / 30 / 50 sports leagues a year). Platinum has a cap like the others;
  no copy says any plan is unlimited, and "Unlimited" shows only where the settings say so.
- **Every league is gifted Premium for 6 months, then moves to Free** (it does not start on
  Platinum). The pages show the gift (*Gift copy*); they name no default plan.
- **Platinum is "Coming soon"** (Derek, payments Q2): not selectable by commissioners, shown as
  Coming soon on both pages, read from config. Built in #972.
- The plan settings themselves (Platinum's cap, the matrix defaults, the gift date) are #986,
  not these slices.

## Out of scope

- **Payments**, renewal and yearly pricing: #931, `plans/payments.md`.
- **Per-event pricing**, paying once to raise one contest's entry cap, which Derek expects to be
  the first thing people pay for: designed after this, #968. Both pages leave room for a "Need
  more room for one pool?" block under the cards.
- **New caps or features**: these pages show whatever PLAN_CONFIG holds and need no change when
  a feature is added, beyond its name and description in `plan-labels.ts`.

## Questions

All answered (Derek 2026-10-24): every recommendation agreed; on 2 the toggle was kept, then dropped when pricing went annual only (*Pricing model*).

1. **Decided (Derek 2026-10-24): yes.** **Public page at `/plans`, open to anyone, with `GET /plans` made public?** Recommended: yes.
   It holds no league or user data, and How to Play already reads two public lists the same way.
2. **Decided (Derek 2026-10-24): yes; the toggle he kept was later dropped (annual only).** **Price slot until prices exist**: while `GET /billing/prices` is empty, the paid
   plans show **Free** where the price will go. A "[PRICE]" placeholder or a made-up number on a
   public page would read as broken or binding.
3. **Decided (Derek 2026-10-24): yes.** **Highlights built from the config**, with three or more features of one group starting at
   the same plan shown as one counted line ("7 more emails")? Recommended: yes, so a root admin's
   change on `/manage/plans` can never leave a card saying the wrong thing.
4. **Decided (Derek 2026-10-24): yes**; slice 1 also moves the code default in
   `PLAN_SETTINGS`. **Premium has no feature of its own today**, only bigger caps: every feature starts at Free,
   Pro or Platinum. Move **All years** to Premium on `/manage/plans`, keeping the record book at
   Platinum? Recommended: yes, so every step up adds something to name on its card. It is a
   setting, so it needs no build; the page works either way. Note the code default only applies
   where PLAN_CONFIG has never been saved; on QA, where it has, the change is a save on
   `/manage/plans`.
5. **Decided (Derek 2026-10-24): no badge.** **A "Most popular" badge?** Recommended: none for now. Nobody pays yet, so there is nothing
   true to say; the card style supports one later (the mockup's tweak shows it).
6. **Decided (Derek 2026-10-24): yes.** **A one-line description under each feature** (in `plan-labels.ts`), on the public table and
   as help text on the commissioner table? Recommended: yes. "Contest not open email" means
   little to a visitor without "For commissioners: a contest still needs opening".
7. **Decided (Derek 2026-10-24): yes.** **The commissioner page replaces the current Choose a plan form**, at
   `/league/:code/admin/plan` with the old path redirecting? Recommended: yes; one page to
   compare and choose, instead of a radio list over a table.
8. **Decided (Derek 2026-10-24): yes.** **Usage on the commissioner page**: sports leagues this year (already served) and the
   biggest open contest's entry count (new), from one small `GET /leagues/:id/contests/plan-usage`?
   Recommended: yes. It is what makes "You use 34" possible, and Create contest keeps its own
   sports leagues call.
9. **Decided (Derek 2026-10-24): yes.** **Every public button says Start free while payments are off?** Recommended: yes, because every
   new league starts free on the default plan; per-plan buttons arrive with payments.
10. **Decided (Derek 2026-10-24): yes.** **Signed-in visitors** on `/plans` see **Choose for a league**, straight to the Plan page
    when they commission one league, otherwise My leagues? Recommended: yes.

## Slices

Ticketed under epic #969 as #971, #972 and #973; the issues carry the live state.

1. **Shared comparison pieces and the public API**: `GET /plans` public, plan taglines and
   feature descriptions in `plan-labels.ts`, the highlight builder beside
   `buildPlanComparison`, the plan cards and the table with collapsible groups. Tests for the
   builder (a feature moved in config moves its tick and its highlight).
2. **Commissioner Plan page**: the new page and redirect, `plan-usage` (this year's sports
   leagues, and each open contest's name and entry count), the confirm with its
   warnings and hidden-feature list, links from league settings and the cap notices.
3. **Public plans page**: the route, header and How to Play links, questions, Start free, the
   signed-in button, phone layout.

Slices 2 and 3 run in parallel after 1. Their gift copy, expansion prices and Platinum "Coming
soon" wait for #986 and the `BILLING_CONFIG` price lists; the rest does not.

Expansion prices and the gift copy are wired once #986 and payments' price list land; until
then the cards show the lowest plan at $0 and "Free for now" on the rest.
