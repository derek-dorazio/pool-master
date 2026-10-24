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
| Yearly prices | Payments' public price list (amounts read from Stripe; empty while payments are off) | A price changes in Stripe |

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
- **Phone**: all four columns stay, with short headings (Free, Pro, Prem., Plat.) and ticks,
  which fit a 390 px screen; the one-line descriptions drop to keep rows short.

## Public plans page

Route `/plans`, outside the sign-in guard, like How to Play. Sections, top to bottom:

1. Header with How to Play, **Plans**, Sign in and Start free.
2. Heading, one line on what every plan includes, and the **"Every plan is free for now"**
   pill, kept while payments are off (`plans/monetization-strategy.md` *At launch*).
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

**Buttons while payments are off**: every new league starts free on the default plan, so a
button that says "Start with Pro" would promise something the app does not do. Every button says
**Start free** and goes to sign-up (Q9). Once payments are on, the paid plans' buttons say
"Start with Pro" and, after sign-up and the first league, open that league's Plan page with Pro
picked. A signed-in visitor sees **Choose for a league**: straight to the Plan page when they
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
   - "Every plan is free for now, so this takes effect at once and costs nothing."
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

### Choosing a plan once payments are on

This page only hands over; the flow itself is `plans/payments.md`. What each plan button does
depends on the league's billing state, and the table in `plans/payments.md` §6 *Who is in
charge of the plan* is the rule; this page does not restate it. The page reads the league's
billing state from `GET /leagues/:id/billing` and picks, per button:

- the free change through `PUT /leagues/:id/plan`, at once (payments off, or before the
  renewal date; or moving down with no subscription after it);
- a plan change through billing, with no new checkout, when a subscription exists: up applies
  now with a prorated charge, down is scheduled for the period end (§7). The current plan card
  then says "Platinum until [date], then Pro" with **Keep Platinum** to undo;
- checkout with the chosen plan and interval, when moving up after the renewal date with no
  subscription.

The confirm says which of these will happen before the commissioner presses it.
- **Prices** come from payments' public price list, read from Stripe, empty while payments are
  off. Both pages read it, never config or copy. Yearly only (*Pricing model* below).

## Pricing model (Derek 2026-10-24, `plans/payments.md`)

This supersedes the yearly/monthly parts of this doc, Q2's toggle included.

- **Annual only**, no monthly at first: there is no Yearly/Monthly toggle. Each paid plan
  shows one yearly price once prices exist, read from payments' price list, never typed in
  the UI; until then the cards keep "$0" for the lowest plan and "Free for now" for the rest.
- **Caps** come from PLAN_CONFIG as before (the numbers Derek set: 20 / 50 / 100 / 500 entries
  per contest, 5 / 15 / 30 / 50 sports leagues a year). Platinum has a cap like the others;
  no copy says any plan is unlimited, and "Unlimited" shows only where the settings say so.
- **Each plan has its own per-contest expansion prices** (`plans/payments.md`); a card may
  list them once payments serves them. Expansions are bought on the contest.
- **Every league is gifted Premium for 6 months, then drops to Free.** The pages name no
  default plan, so nothing here changes with it.
- **Platinum is "Coming soon"** (Derek, payments Q2): not selectable by commissioners, shown as
  Coming soon on both pages, read from config. Built in #972.

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
   biggest open contest's entry count (new), from one small `GET /leagues/:id/plan-usage`?
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

Slices 2 and 3 run in parallel after 1.

Prices are wired to payments' price list when the payments build adds it; until then the
cards show the lowest plan at $0 and the rest free for now, which is what an empty list means.
