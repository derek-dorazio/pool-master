# Monetization strategy

**Tracking issue:** #581

Written 2026-10-10 for Derek's review; sports and pool styles added 2026-10-12; tier order and the levers revised 2026-10-22. Open questions sit under the section they belong to,
each with a recommendation. Research and strategy only: no implementation is
scheduled. **Taking payments is out of scope** throughout: this document covers what to sell
and how the app would know a league or contest has it, not how money is collected.

## Summary

- Keep a **Free** level forever: the default contest type (tiered selection) and a cap of
  **20 entries per contest**. Put the cap on entries per contest, not squads per league (see
  *Where the cap goes*).
- Sell two things, which stack:
  1. **Per-contest unlocks** (à la carte): a bigger entry cap, or a non-default selection
     type, bought for one contest.
  2. **League membership** (annual): **Pro, then Premium, then Platinum** (Derek's order,
     2026-10-22). Each raises the cap for every
     contest in the league, opens the other selection types, and adds features that make the
     league stickier year over year: history, automated reminders, live standings updates.
- Two more ways to package it (added 2026-10-12, Derek's ideas): by **how many sports** a
  league plays (free plays one, paid tiers play them all), and by **pool style**, office
  pool, pick'em or DFS-style, each sold almost as its own product with light branding, and
  Platinum getting all of them. See *Sports and pool styles*.
- **Plans differ mostly by levers, not by feature lists** (Derek, 2026-10-22): entries per
  contest, how many sports leagues a league plays, league size and pool styles. Features
  (cups, championship, history, emails) are classed only as finely as they naturally need,
  often just free or paid. See *The levers*.
- Charge for **scale, depth and automation**. Keep the core loop free: invite, pick, watch the
  leaderboard, see who won. A league that cannot get started never pays.
- The commissioner is the buyer in every model we found. Never charge a member to join.
- Fitting it into the system is small, as Derek expected: one plan level on the league, one
  list of unlocks on the contest, one function that turns those into entitlements, and checks
  at three places that already exist. Sports and pool styles use the same function: a
  contest option is offered only when it is built (the sport registry), released by the root
  admin, and covered by the league's plan or the contest's unlocks (see *Enablement*). History and notifications are the real work, and they
  are features, not plumbing.

## What other sites charge

Prices below come from public pages or reviews found on 2026-10-10. Several come from
secondary sources and some are dated; they are for orientation, not quotation.

### Office pool sites (charge per entry, per pool)

| Site | Model | Public prices |
|---|---|---|
| RunYourPool | Per entry, falling with volume; free through the first week | First 10 entries $20, then $2.00 each to 50, $1.50 to 200, $1.00 to 500, $0.75 beyond (from a competitor's comparison). That is about **$100 for 50 entries, $175 for 100, $325 for 200**. |
| Gridiron Games | Per entry, first entry free | $2.00 (entries 2–50), $1.50 (51–200), $1.00 (201–500), $0.75 (501+) |
| Splash Sports, self-managed PGA majors (2026) | Flat base plus per entry, entertainment-only | $20 up to 10 entries, then $1.50 (11–50), $1.25 (51–200). Splash's real business is a cut of real-money entry fees, plus rewards for commissioners who bring in new players. |
| NASCAR Pools Online | Base plus per team, two-race free trial | $24 for the first 10 teams, then $1.98 down to $1.43 per team by volume |
| OfficePoolStop | Free and ad-supported; paid cosmetic upgrades | Remove ads for the league about $25, or $4.50 for one player; logo and colours $15–17.50 (2023 prices). Deadline reminders are **free**. |
| Pro Tour Fantasy Golf | One-time league setup fee | $150–180 (two copies of the page disagree) |
| Majors Challenge (golf) | Commissioner sets the entry fee; extra setup fee for club and association leagues | Not public |

### Fantasy league platforms (charge per league per season, or per user)

| Site | Model | Public prices | What is behind the paywall |
|---|---|---|---|
| CBS Sports Commissioner | Per league per season, 14-day trial | $179.99 ($149.99 early bird) | Full customisation, and a "robust league history": per-season snapshots, champions, a league record book |
| Fantrax Premium | Per league per season | About $130 | Advanced formats (salaries, contracts, auction), commissioner controls for stat corrections and roster rules |
| Yahoo Commissioner Plus | Per league, bought again each season | Launched at $25 | Alternative formats (play the league median, second opponent, 7-team playoffs) |
| Yahoo Fantasy Plus / Ultra | Per user per year | $35 / $79.99 (Ultra reported Aug 2026) | Personal tools: trade and lineup help, more leagues per user |
| ESPN, Sleeper | Free | — | Sleeper has free league history (top three and standings per season, all-time standings); Yahoo has a free trophy case (top-three finishes) |

### What this says

- **Two pricing shapes dominate.** Office pools meter by entry count; fantasy platforms sell a
  league a season. Derek's two mechanisms map onto exactly these: per-contest unlocks are the
  office-pool shape, league membership is the fantasy shape. Offering both is unusual and
  lets a once-a-year Masters pool and a weekly league each pay the way that suits them.
- **Our à la carte numbers are well below market** for big pools. Derek's $10 / $20 / $30 for
  100 / 200 / unlimited compares with roughly $175 and $325 elsewhere. Those sites price a
  whole season and we would price one tournament, so the comparison is loose, but there is
  room to charge more for the top bands if wanted. Cheap and simple is also a fair strategy
  for a new product.
- **Free trials are standard** (first week, two races, 14 days).
- **History is the stickiest paid feature.** CBS leads with it; Sleeper and Yahoo give a basic
  version away. That supports Derek's split: a basic list on a lower tier, dashboards on the
  top tier.
- **Basic deadline reminders are free elsewhere** (OfficePoolStop). See *Notifications* for how
  to split them.
- **Alternative formats are the classic paid unlock** (Fantrax, Yahoo), which supports gating
  budget, category and snake selection.

## Strategy ideas

1. **Freemium with an entry cap** (Derek's). Free forever, tiered selection, 20 entries per
   contest. The office pool that outgrows 20 is the one that pays.
2. **Per-contest unlocks** (Derek's). Bought for one contest:
   - Entry cap: 100 ($10), 200 ($20), unlimited ($30).
   - Selection type: budget ($5), and later category and snake.
3. **League membership tiers** (Derek's). Annual, applies to every contest in the league.
   Packaging in the next section.
4. **Majors pass** (new). A bundle between the two: one price unlocks the same upgrades for
   every contest a league runs on the four majors in a year. Golf pools cluster around the
   majors; many leagues will never need a weekly membership but run four big contests.
5. **Free trial of the top tier** (new). A new league's first contest gets top-tier features, so the
   commissioner sees reminders and history working before being asked to pay.
6. **Branding** (new). League logo upload, colours, custom trophy names. Cheap to build, and
   OfficePoolStop sells it on its own. Fits into a tier rather than as a separate sale.
7. **Organisation level** (new, later). Golf clubs, associations and companies run several
   leagues (Majors Challenge sells to PGA club pros and associations). Several leagues under
   one account, shared commissioners, one bill.
8. **Commissioner referral credit** (new, later). A commissioner who brings in another
   commissioner earns a free unlock. Splash pays cash for this; we would give credit, which
   needs no payments work.
9. **Ad-supported free level** (considered, not recommended now). It funds OfficePoolStop and
   ESPN, but it needs volume we do not have and makes the product look cheap. Revisit with
   traffic.
10. **Individual member subscription** (considered, later). Yahoo sells personal tools to
    players. For us that could be a personal dashboard across all of a user's leagues. Only
    worth it once users sit in several leagues.

Out of scope: any cut of entry fees or prize pools (payments).

## Proposed packaging

A starting point to react to, not a decision. Names follow Derek's message.

| | Free | Pro | Premium | Platinum |
|---|---|---|---|---|
| **Entries per contest** | 20 | 50 | 100 | Unlimited |
| **Sports leagues the league plays** (PGA Tour, NFL, ...) | 1 | 3 | 10 | All |
| **League size** (active squads) | 20 | 50 | 100 | Unlimited |
| **Pool styles** (office pool, pick'em, DFS-style) | 1 | 1 | 2 | All |
| Selection types | Tiered | All in its styles | All in its styles | All |
| Core loop: invites, picks, live leaderboard, results | ✓ | ✓ | ✓ | ✓ |
| Results of this season's contests | ✓ | ✓ | ✓ | ✓ |
| Sports league cups, FedEx-style (#841) | | ✓ | ✓ | ✓ |
| League championship: calendar-year standings and trophy (#863) | | ✓ | ✓ | ✓ |
| History: past years, all-time summary (#837) | see `plans/season-cups.md` §7 | | | |
| Emails (#845) | see `plans/email-notifications.md`, *Class* | | | |
| Branding: logo, colours | | | ✓ | ✓ |
| Export results (CSV) | | | | ✓ |

The bold rows are the levers; Derek's numbers (2026-10-22) are examples to tune in app
settings, not decisions. The feature rows only say from which plan a feature starts.

Emails (Derek 2026-10-22): every email in `plans/email-notifications.md` carries a
**notification class**, not a plan name, so this plan only has to map classes to plans. There
are three: Essential and A go to every league, free included (account and membership email; a
contest opening, receipts, final results), and B goes to paid plans (reminders, nudges, live
standings). An email about a gated feature (cups, the championship, season standings, trophies)
goes wherever that feature is on. Derek reviews this first guess.

Rules that make the two mechanisms work together:

- **A contest gets whichever is better**, its league's tier or its own unlocks. A Pro
  league can still buy "unlimited" for its one huge Masters contest.
- **Unlocks belong to the contest and never expire.** A cap upgrade can be bought any time
  until picks close, because the moment of need is a full contest mid-signup. A selection-type
  unlock must come before the contest is opened, since its selection type locks then.
- **Downgrades never break anything.** A contest keeps the cap and selection type it was
  opened with. History is hidden when a league drops a tier, never deleted, and comes back if
  it upgrades again: that is the reason to renew.
- **Free keeps this season's results visible.** Hiding all history from free leagues would
  make last week's winner vanish, which reads as a bug. Past seasons are what the paid tiers
  open.

#### Open questions: contest unlocks vs league tiers

Each has a recommendation; answer only where you disagree.

1. **Offer both mechanisms from the start, or one first?** Both is the plan, but league
   tiers alone are simpler to explain and build. Recommended: build the model for both, ship
   league tiers first, and add contest unlocks once a commissioner hits a cap.
2. **Three paid tiers or two?** Decided (Derek, 2026-10-22): three, Pro, Premium and
   Platinum, told apart mainly by the levers.
3. **Which features can be bought à la carte?** Recommended: only entry caps and selection
   types. History, reminders and branding are league-wide by nature and stay tier-only, which
   gives a league a reason to subscribe.
4. **Does a contest's unlock count toward a later tier?** For example, credit for unlocks
   bought this season against a Premium upgrade. Recommended: no for now; it only matters
   once payments exist.
5. **Can the same unlock be bought twice in steps** (100, then later 200)? Recommended: yes;
   the higher one wins and the lower one is simply superseded.
6. **Should a free league's first contest get a trial of the top tier?** Recommended: yes,
   so the commissioner sees reminders and history working before being asked to pay.
7. **Majors pass worth offering** (one price for a league's four majors contests)?
   Recommended: yes, as a later addition once unlocks exist.
8. **Who may grant plans and unlocks before payments exist?** Recommended: root admin only,
   from the root admin screens.
9. **What happens when a league's tier lapses mid-season?** Recommended: contests already
   open keep what they opened with; new contests get the free level; history is hidden, not
   deleted.

### Where the cap goes

Derek asked whether the cap belongs on squads per league or entries per contest.
**Recommendation: entries per contest.**

- A squad cap blocks invites, which is how leagues grow and how we find new commissioners.
  Casual members who sit out most contests would still count against it.
- An entry cap scales with what the league actually gets from each contest, and it is the
  unit every office-pool site prices by.
- It sits next to the existing per-team entry limit, so commissioners already think in these
  terms.

#### Open questions: the entry cap

1. **Cap on entries per contest rather than squads per league?** Recommended: entries per
   contest.
2. **Free cap of 20, then 50 (Pro), 100 (Premium) and unlimited (Platinum)?** Derek's examples
   (2026-10-22). Recommended: start there; the numbers live in app settings, so tuning needs no
   deploy.
3. **Do draft (unsubmitted) entries count toward the cap?** Recommended: yes, every entry
   counts, so the count never surprises anyone at submit time. Deleting a draft frees a slot.
4. **What does a member see when the contest is full?** Recommended: the contest page shows
   "20 of 20 entries", the add-entry button is disabled with "This contest is full", and the
   server refuses with its own error if someone gets there anyway.
5. **What does the commissioner see?** Recommended: the same counter on their contest page,
   a heads-up at 80% full, and an upgrade note when full.
6. **Can a commissioner set a lower cap than the plan allows?** Recommended: yes, an optional
   "maximum entries" on contest settings, never above the plan's cap.
7. **Can the cap be raised after the contest opens?** Recommended: yes, any time until picks
   close; it can never be lowered below the entries already made.

## Sports and pool styles

Two more vectors from Derek (2026-10-12). Both narrow *what a league can run*, where the cap
narrows *how big* it can run. Both reuse the same plan level, the same unlocks and the same
entitlements function as the rest of this document.

### Vector: number of sports leagues

Revised 2026-10-22 (Derek): the count is of **sports leagues** (PGA Tour, LPGA Tour, NFL, NBA,
Premier League), not sports, and it rises with the plan: for example Free 1, Pro 3, Premium
10, Platinum all. Men's and women's leagues are separate leagues already, so the PGA Tour and
the LPGA Tour are two.

- **How a league "has" a sports league**: the league picks its sports leagues in league
  settings, up to its plan's number. Creating a contest on an event of another sports league
  shows it locked with an upgrade note to the commissioner.
- **Per-contest unlock**: a league can pay once to run one contest in a sports league past its
  number, the same way it can buy a bigger cap. This matters most for March Madness: the
  biggest office-pool event of the year, and a golf league that hits a locked wall there instead
  of a small one-off price is the league most likely to leave.
- **Market note**: in the sites we looked at, sport is not what is charged for. RunYourPool
  prices per entry across 11 sports. Charging by count is a differentiator but also a risk: it
  puts a wall in front of growth. The per-contest unlock is what softens it.

#### Open questions: number of sports leagues

1. **Numbers per plan**: Free 1, Pro 3, Premium 10, Platinum all? Derek's examples.
   Recommended: start there, in app settings.
2. **Can a league swap one of its sports leagues?** Recommended: yes, between contests (no open
   contest on the one being dropped); its past results stay visible under the usual history
   rules.
3. **What counts as "in use"?** Recommended: the league's chosen sports leagues in settings,
   not those of its past contests, so history never counts against a league.
4. **Offer a per-contest sports league unlock?** Recommended: yes, priced like the cap bands
   (around $10), so a free golf league can run its one March Madness pool.
5. **Does a new sports league launch open to everyone first?** Recommended: yes, every league
   gets a new sports league free for its first season, then it follows the plan. Early users are
   the feedback loop.

### Vector: league size

New 2026-10-22 (Derek): upper plans unlock larger leagues, counted as **active squads** (for
example Free 20, Pro 50, Premium 100, Platinum unlimited). This sits beside the entry cap; it
does not replace it (*Where the cap goes*).

#### Open questions: league size

1. **Count active squads, not members?** Recommended: yes. Co-owners share a squad, so
   counting squads matches how leagues think and never punishes a shared team.
   Inactive squads don't count, so a commissioner can make room without deleting anyone.
2. **What happens at the limit?** Recommended: invites still send, because invites are how
   leagues grow. Accepting one past the limit shows "This league is full" and tells the
   commissioner how to upgrade; nobody already in the league is affected.
3. **Same numbers as the entry cap?** Recommended: yes for now (20, 50, 100, unlimited), so
   there is one set of numbers to explain.

### Vector: pool style as a product line

Derek's idea: the kinds of pool are different enough to feel like different sites, each with
its own light branding, and Platinum gets all of them. Three styles:

| Style | What it feels like | Contest formats and selection types (today's enums) | Sports |
|---|---|---|---|
| **Office pool** | One tournament, pick a lineup, watch a leaderboard; the classic golf or March Madness pool | `ROSTER` with `TIERED`, later `SNAKE_DRAFT` and category | Golf, tennis, March Madness team pools, races |
| **Pick'em** | A season of weekly game picks: straight-up, against the spread, confidence, survivor | `PICKEM_CONFIDENCE`, `SURVIVOR`, `BRACKET_PICK_EM`, `PICK_EM` | NFL, college football, AFL, soccer, March Madness brackets |
| **DFS-style** | Salary cap lineups, many entries, ownership percentages, fast single-event contests | `ROSTER` with `BUDGET_PICK`, `OPEN_SELECTION` | Golf first, then any sport with prices |

- **One app, three faces**: a league has a style (or several on Platinum). The style sets the
  accent colour, the league home page's emphasis (a leaderboard for office pools, this week's
  games for pick'em, the salary cap and ownership for DFS), default wording, and which
  contest formats Create contest offers first. The domain and the code stay one product.
  Separate domains or app names per style are a marketing choice that can come later on top.
- **Conflict with the earlier unlock**: budget selection was a $5 per-contest unlock above. In
  this model budget belongs to DFS-style, so an office pool league buying budget for one
  contest is the same per-contest unlock, just named as "a DFS-style contest".
- **Pricing shape**: Free gets one style (office pool by default), Pro the full selection
  types within its one style, Premium two styles, Platinum all.

#### Open questions: pool styles

1. **Three styles, as above?** Recommended: yes; budget sits in DFS-style, tiered and snake
   in office pool.
2. **Can a league change its style?** Recommended: yes, any time; the style changes what it
   can create next, never contests it already has.
3. **Is the style chosen when the league is created?** Recommended: yes, as the first
   question of league creation, defaulting to office pool, because it sets the look from
   the first screen.
4. **How strong is the branding difference?** Recommended: light: accent colour, home page
   emphasis and wording. Different logos or domains only if marketing asks later.
5. **What does a Platinum league with all styles look like?** Recommended: the commissioner
   picks the league's main style for its look; contests of every style are available.
6. **Does a member see the style?** Recommended: only through the look; no style label or
   plan badge for members.

## The levers

Derek (2026-10-22): plans differ along several levers at once, and the levers do most of the
work. A feature does not need a different version on every plan.

| Lever | Kind | Where it is checked |
|---|---|---|
| Entries per contest | Number | Adding an entry (*Where the cap goes*) |
| Sports leagues the league plays | Number | League settings and Create contest (*Number of sports leagues*) |
| League size (active squads) | Number | Accepting an invite (*League size*) |
| Pool styles | Number, plus which | League settings and Create contest (*Pool style*) |
| Selection types | Set | Create contest (*Enablement*) |
| Features | Feature classes | Each feature's routes, tiles or emails |

The numbers live in an app settings group, one row per plan, so they change without a deploy.
All levers go through the one entitlements function (*How it fits the current system*).

### Features being built for paid plans

These features are built so there is something worth upgrading for. Each one tags its views,
tiles or emails with a plan-agnostic **service class** (Essential every league, A free and up,
B from Pro, C from Premium, D Platinum), and uses only as many classes as it naturally needs;
two (free and paid) is often enough. This plan maps each class to the first
plan that gets it. Nothing is gated yet.

| Feature | Ticket | Classes | Documented in |
|---|---|---|---|
| Sports league cups (FedEx-style points race per sports league) | #841 | B (paid, from Pro): every cup view | `plans/season-cups.md` §7 |
| League championship (calendar-year standings, trophy, medal tiles, finish matrix) | #863 | B (paid, from Pro): every championship view | `plans/season-cups.md` §7 |
| League history (past years, drill to past contests, all-time summary) | #837 | Contest results Essential; past years follow the championship's and cups' class; all-time summary D | `plans/season-cups.md` §7 |
| Email notifications | #845 | Per email | `plans/email-notifications.md`, *Class* |

Pro and Premium leagues see the same cups and championship; Premium's bigger numbers on the
levers (more entries, more sports leagues, more squads) are what make it worth more.

## Paid features worth paying for

Grouped by area, with why each is worth money. Engagement features that bring people back
(chat, trash talk, live leaderboard) stay free: they feed growth.

### History (Derek's)

- **Past contests list**: every completed contest with its winner and final standings.
- **Season dashboard** (CBS style): per year, the winners and losers, most wins, best and worst
  finishes, average position by team.
- **Team page history**: one squad's record across every contest and season.
- **All-time league dashboard**: a running total of wins per team over the years, the chart
  that keeps old members coming back.
- **Record book and trophy case**: best score ever, biggest winning margin, most wins in a
  season, back-to-back champions; trophies on each team for top-three finishes (Yahoo does
  this free, so it belongs on top of the dashboards, not alone).

Good news for cost: results are already frozen per entry when a contest settles, so history
is mostly reading and aggregating data we keep, not new data capture.

#### Open questions: history

1. **Free keeps this season's results visible, past seasons paid?** Recommended: yes. Hiding
   last week's winner would read as a bug.
2. **What is a season?** Recommended: the calendar year of the event's start.
3. **How do locked pages behave?** Recommended: the History tab is shown to every league; on
   a free league it lists past seasons by name with a short "Pro shows past seasons"
   note instead of the results.
4. **Who sees the upgrade note?** Recommended: everyone sees that history is locked, but only
   the commissioner sees how to unlock it.
5. **Do history dashboards count removed or inactive teams?** Recommended: yes, shown with
   their name as it was; history should not change when a team leaves.

### Notifications (Derek's)

- **Entry deadline reminders**: one day and one hour before picks close. The paid version only
  goes to teams that have not submitted, which is what makes it useful to a commissioner who
  otherwise nags by text. Competitors give a basic reminder away, so the split above keeps a
  one-day reminder free.
- **Contest opened**: tells the league a new contest is ready for picks.
- **End-of-day standings** during a live event (Derek's Platinum idea; Premium above): who leads,
  who moved, your team's position.
- **Final results**: winner and full standings when the contest settles.
- **Commissioner announcement**: a message to the whole league from the commissioner.

#### Open questions: notifications

1. **Keep a one-day reminder free?** Competitors give reminders away. Recommended: yes; the
   last-hour reminder and "only to teams not yet submitted" are the paid part.
2. **Email only, or in-app too?** Recommended: email first; in-app notices later.
3. **Can members turn reminders off?** Recommended: yes, per member, in account settings;
   commissioners can't force them on.
4. **Who gets them for a team with co-owners?** Recommended: every owner of the team.
5. **Can the commissioner choose the reminder times?** Recommended: no, fixed at one day and
   one hour to start.
6. **When is the end-of-day standings email sent?** Recommended: once a round's scores are
   final for the day, one email per league per day, not one per contest.

### Scale and formats

- Bigger entry caps, alternative selection types (budget now, category and snake later).
- **Season-long standings across contests**: points for finishing positions across all of a
  league's contests in a year, crowning a season champion. Pairs naturally with history.
- **Multiple contests on one event** with different formats, if a cap on contests per event is
  ever wanted for the free level.

#### Open questions: scale and formats

1. **How does the Create contest page show a locked selection type?** Recommended: the
   format card is shown with a lock and "Budget is a Pro format", and can't be picked;
   the commissioner sees how to unlock it.
2. **Which selection types are free?** Recommended: tiered only, as you said.
3. **Is season-long standings a top-tier feature?** Recommended: yes, it pairs with history.
4. **Cap the number of contests per event on the free level?** Recommended: no for now.

### Commissioner convenience

- **Paid tracking**: a checkbox per entry for "has paid". It records what the commissioner
  collected elsewhere and takes no money, so it sits just inside the scope line. Office pool
  commissioners ask for this constantly. Derek to confirm it is in scope.
- **Co-commissioners** beyond one.
- **Export** of entries and results.
- **Branding**: logo upload, colours, custom trophy names.

#### Open questions: commissioner convenience

1. **Is paid tracking in scope?** It records payments made elsewhere and takes no money.
   Recommended: yes, as a Pro feature.
2. **Who sees who has paid?** Recommended: commissioner only.
3. **How many co-commissioners per tier?** Recommended: one on free, unlimited on paid tiers.

### Live event extras

- **Pick popularity**: after picks are revealed, how many entries took each golfer. Popular in
  daily fantasy and cheap for us, since picks are revealed when the event starts.
- **Projected finish**: where each entry would finish if the event ended now, including the
  cut. Partly what the leaderboard already shows.

#### Open questions: live event extras

1. **Pick popularity: which tier?** Recommended: Premium and above, shown only after picks are
   revealed.
2. **Projected finish worth building?** Recommended: later; the live leaderboard covers most
   of it.

## How it fits the current system

Lightweight by request. Derek's belief holds: once the league and the contest carry their
level, caps and selection gating are small changes at places that already make the same kind
of decision.

### Domain model

- **League plan**: a typed enum `LeaguePlan` (`FREE`, `PREMIUM`, `PRO`, `PLATINUM`) and a
  `league_subscriptions` table holding a league's plan with start and end dates and a typed
  source (`MANUAL_GRANT` and `TRIAL` now, a purchase source when payments arrive). A league
  with no current row is `FREE`. The history of rows is kept, so upgrades and lapses are
  auditable.
- **Contest unlocks**: a `contest_unlocks` table, one row per unlock on a contest, with a typed
  enum (`ENTRY_CAP_100`, `ENTRY_CAP_200`, `ENTRY_CAP_UNLIMITED`, `SELECTION_TYPE_BUDGET`, later
  category and snake) and the same typed source.
- **Who grants them now**: the root admin, from the existing root admin screens. With payments
  out of scope this is how the whole feature gets built, tested and even trialled with real
  leagues; payment later just becomes another way to write the same rows.

### One entitlements function

A single service resolves a league's plan and a contest's unlocks into what that contest may
do: its entry cap, its allowed selection types, and a set of typed `PremiumFeature` values for
the league. Every check below calls it, so there is one code path for "may this happen"
(`rules/architecture-rules.md` §4 *Service Topology*).

The numbers per plan (caps, which selection types) live in a new app settings group, like the
budget pricing profiles, so they can be tuned without a deploy. The feature names stay code
enums.

### Where the checks go

- **Entry cap**: creating an entry already checks the per-team entry limit
  (`packages/core-api/src/modules/contests/service.ts`, `createEntry`). The contest-wide cap is
  a second check beside it with its own typed error. It needs a lock or a counted insert inside
  the transaction so two people taking the last slot at once cannot both get in.
- **Selection type**: contest creation already validates the selection type against its
  template (`packages/core-api/src/modules/contest-management/service.ts`). The entitlement
  check goes beside it, and the template list marks locked formats so the Create contest page
  can show them with an upgrade note instead of hiding them.
- **Freeze at open**: opening a contest already locks its settings (#117). It also records the
  contest's cap and selection-type entitlement then, which is what makes downgrades safe.
- **Features**: history routes and pages check the league's features; reminder and digest
  sends check them before sending.
- **Contracts**: the league gains its plan and features; the contest gains its entry cap and
  current entry count, so the app can show "18 of 20 entries" and locked states. The server
  stays the authority (`rules/architecture-rules.md` §2 *Contract-First API Architecture*).

#### Open questions: how it behaves

1. **Where does the league's plan show?** Recommended: a plan badge on league settings for
   the commissioner; members don't need to see it.
2. **What does the root admin screen offer?** Recommended: on a league, grant or end a plan
   with dates; on a contest, add or remove unlocks; every change recorded with who made it.
3. **Plan numbers in app settings or code?** Recommended: caps and allowed selection types
   in a new app settings group; feature names as code enums.
4. **What happens to an existing league when this ships?** Recommended: every existing league
   starts on a free Platinum grant for a set period, so nothing it already uses disappears.

### Enablement: sports, pool styles and selection types

Derek's requirement: enablement logic and indicators that turn any combination of sports and
contest types on and off. Three gates, each owned by one place, checked in order:

1. **Built**: the sport registry (#602, `SportDefinition` in the project's sport extension
   architecture plan) lists which sports exist and which selection types each sport allows.
   A sport or selection type that is not in the registry does not exist for anyone. Code.
2. **Released**: a root admin switch in app settings, per sport and per pool style, for
   rollout: off, on for chosen leagues only (beta), or on for everyone. Lets a new sport ship
   dark and open for one test league first. Data.
3. **Entitled**: the league's plan and the contest's unlocks, through the entitlements
   function above. Data.

An option is offered when all three pass. The entitlements function grows to return, besides
the cap and features, the league's allowed `SupportedSport` set and `PoolStyle` set, and for a
contest the allowed (sport, contest format, selection type) combinations: the registry's list
for the sport, narrowed to the league's styles, narrowed to what the plan and unlocks cover.

- **Typed throughout**: `PoolStyle` is an enum; each style is a `PoolStyleDefinition` in the
  shared package (formats, selection types, accent token, wording), registered the same way as
  `SportDefinition`, so the web app and the API read one source.
- **Indicators**: every option the app lists (a sport, a style, a format card on Create
  contest) carries a typed availability: `AVAILABLE`, `LOCKED_BY_PLAN` (shown with a lock and
  an upgrade note), or hidden when not built or not released. The reason is an enum, so the
  page decides how to show it and never works it out itself.
- **One gate, no branching elsewhere**: as with sports, nothing outside the entitlements
  function compares plans or tiers. A lint rule like the proposed `no-sport-branching` can ban
  comparisons against `LeaguePlan` values elsewhere.
- **Where the checks go**: the same places as above. Contest creation checks the event's sport
  and the chosen format and selection type; league settings checks the sport and style
  choices; the league home page reads the style for its look.

#### Open questions: enablement

1. **Is the release switch per sport and per style, with a per-league beta list?**
   Recommended: yes, in one new app settings group.
2. **Do selection types also get a release switch?** Recommended: no; a selection type ships
   with the sport or style that uses it, so the sport and style switches cover it.
3. **Shown locked or hidden?** Recommended: built and released but not entitled is shown
   locked with an upgrade note; not built or not released is hidden.
4. **What does a contest keep when its league loses an entitlement?** Recommended: the same
   as the cap: everything is frozen when the contest opens, so it runs to the end.

### What does not exist yet

- **Scheduled notifications**: email today is invite and system mail only. Reminders need a
  sweep on a timer, like the event lifecycle scheduler that already runs every five minutes
  (`packages/core-api/src/modules/events/event-lifecycle-scheduler.ts`), plus a record of what
  was sent so nobody gets a reminder twice. A real feature, one epic.
- **History pages**: the frozen results exist; the pages and aggregations do not. A "season"
  needs a definition (the event's year is the simple answer). One epic, possibly two with
  dashboards.
- **Sport and style plumbing**: the sport registry (#602) is a prerequisite for the sport
  gate; pool styles need their definitions, a league style setting and the look per style.
  Each is a small slice after the plan model.
- **Locked-state UI**: upgrade notes on locked formats, the entry counter, a plan badge on
  league settings. Small, rides with the slices above.

Rough shape: the plan and unlock model with root admin granting is one or two PRs; caps and
selection gating one or two more. History and notifications are each their own epic.

## Sources

- RunYourPool cost FAQ: https://www.runyourpool.com/support/faq.cfm?id=29
- Pick'em app comparison (RunYourPool tiers): https://www.playoffpickems.com/best-pickem-pool-app
- Gridiron Games pricing: https://gridirongames.com/pool-pricing
- Splash self-managed PGA majors pricing 2026: https://intercom.help/entertainment-only-help-center/en/articles/14442362-self-managed-pga-golf-majors-pricing-2026-season
- Splash commissioner model (Sportico): https://www.sportico.com/business/sports-betting/2023/splash-inc-sports-pools-investors-1234724843/
- NASCAR Pools Online pricing: https://www.nascarpoolsonline.com/pricing.php
- OfficePoolStop premium services: https://support.officepoolstop.com/portal/en/kb/articles/premium-services
- OfficePoolStop FAQ: https://officepoolstop.com/faq
- Pro Tour Fantasy Golf features: https://protourfantasygolf.com/features
- Majors Challenge formats: https://www.majorschallenge.com/games
- CBS Sports Commissioner review: https://fantasypros.com/reviews/league-management/cbs-sports
- CBS Sports fantasy football 2009 (league history): https://www.cbssports.com/info/ir/press/2009/fantfoot09
- Fantrax premium (dynasty platforms guide): https://dynastyleaguefootball.com/dynasty-draft-guide-2026-dynasty-platforms/
- Yahoo Commissioner Plus: https://help.yahoo.com/kb/SLN36403.html
- Yahoo Fantasy Plus: https://www.yahoo.com/plus/fantasy/hockey
- Yahoo Fantasy Ultra: https://www.fantasynerds.com/news/story/2026/08/13/yahoo-fantasy-launches-fantasy-ultra-subscription-tier-1595307
- Yahoo trophy case: https://help.yahoo.com/kb/SLN22671.html
- Sleeper league history: https://support.sleeper.com/en/articles/5704241-importing-league-history-to-sleeper
