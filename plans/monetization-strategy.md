# Monetization strategy

**Tracking issue:** #581

Written 2026-10-10 for Derek's review. Research and strategy only: no implementation is
scheduled. **Taking payments is out of scope** throughout: this document covers what to sell
and how the app would know a league or contest has it, not how money is collected.

## Summary

- Keep a **Free** level forever: the default contest type (tiered selection) and a cap of
  **20 entries per contest**. Put the cap on entries per contest, not squads per league (see
  *Where the cap goes*).
- Sell two things, which stack:
  1. **Per-contest unlocks** (à la carte): a bigger entry cap, or a non-default selection
     type, bought for one contest.
  2. **League membership** (annual): Premium, Pro and Platinum. Each raises the cap for every
     contest in the league, opens the other selection types, and adds features that make the
     league stickier year over year: history, automated reminders, live standings updates.
- Charge for **scale, depth and automation**. Keep the core loop free: invite, pick, watch the
  leaderboard, see who won. A league that cannot get started never pays.
- The commissioner is the buyer in every model we found. Never charge a member to join.
- Fitting it into the system is small, as Derek expected: one plan level on the league, one
  list of unlocks on the contest, one function that turns those into entitlements, and checks
  at three places that already exist. History and notifications are the real work, and they
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
5. **Free trial of the top tier** (new). A new league's first contest gets Pro features, so the
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

| | Free | Premium | Pro | Platinum |
|---|---|---|---|---|
| Entries per contest | 20 | 100 | 200 | Unlimited |
| Selection types | Tiered | All | All | All |
| Core loop: invites, picks, live leaderboard, results | ✓ | ✓ | ✓ | ✓ |
| Results of this season's contests | ✓ | ✓ | ✓ | ✓ |
| History: list of every past contest and its results | | ✓ | ✓ | ✓ |
| History dashboards: by season, by team, all-time | | | ✓ | ✓ |
| Record book and trophy case | | | | ✓ |
| Entry deadline reminders (one day before) | ✓ | ✓ | ✓ | ✓ |
| Last-hour reminder, only to teams not yet submitted | | ✓ | ✓ | ✓ |
| Contest opened and final results emails | | ✓ | ✓ | ✓ |
| End-of-day standings email during a live event | | | ✓ | ✓ |
| Branding: logo, colours | | | ✓ | ✓ |
| Season-long league standings across contests | | | | ✓ |
| Export results (CSV) | | | | ✓ |

Rules that make the two mechanisms work together:

- **A contest gets whichever is better**, its league's tier or its own unlocks. A Premium
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

### Where the cap goes

Derek asked whether the cap belongs on squads per league or entries per contest.
**Recommendation: entries per contest.**

- A squad cap blocks invites, which is how leagues grow and how we find new commissioners.
  Casual members who sit out most contests would still count against it.
- An entry cap scales with what the league actually gets from each contest, and it is the
  unit every office-pool site prices by.
- It sits next to the existing per-team entry limit, so commissioners already think in these
  terms.

## Premium features worth paying for

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

### Notifications (Derek's)

- **Entry deadline reminders**: one day and one hour before picks close. The paid version only
  goes to teams that have not submitted, which is what makes it useful to a commissioner who
  otherwise nags by text. Competitors give a basic reminder away, so the split above keeps a
  one-day reminder free.
- **Contest opened**: tells the league a new contest is ready for picks.
- **End-of-day standings** during a live event (Derek's Platinum idea; Pro above): who leads,
  who moved, your team's position.
- **Final results**: winner and full standings when the contest settles.
- **Commissioner announcement**: a message to the whole league from the commissioner.

### Scale and formats

- Bigger entry caps, alternative selection types (budget now, category and snake later).
- **Season-long standings across contests**: points for finishing positions across all of a
  league's contests in a year, crowning a season champion. Pairs naturally with history.
- **Multiple contests on one event** with different formats, if a cap on contests per event is
  ever wanted for the free level.

### Commissioner convenience

- **Paid tracking**: a checkbox per entry for "has paid". It records what the commissioner
  collected elsewhere and takes no money, so it sits just inside the scope line. Office pool
  commissioners ask for this constantly. Derek to confirm it is in scope.
- **Co-commissioners** beyond one.
- **Export** of entries and results.
- **Branding**: logo upload, colours, custom trophy names.

### Live event extras

- **Pick popularity**: after picks are revealed, how many entries took each golfer. Popular in
  daily fantasy and cheap for us, since picks are revealed when the event starts.
- **Projected finish**: where each entry would finish if the event ended now, including the
  cut. Partly what the leaderboard already shows.

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

### What does not exist yet

- **Scheduled notifications**: email today is invite and system mail only. Reminders need a
  sweep on a timer, like the event lifecycle scheduler that already runs every five minutes
  (`packages/core-api/src/modules/events/event-lifecycle-scheduler.ts`), plus a record of what
  was sent so nobody gets a reminder twice. A real feature, one epic.
- **History pages**: the frozen results exist; the pages and aggregations do not. A "season"
  needs a definition (the event's year is the simple answer). One epic, possibly two with
  dashboards.
- **Locked-state UI**: upgrade notes on locked formats, the entry counter, a plan badge on
  league settings. Small, rides with the slices above.

Rough shape: the plan and unlock model with root admin granting is one or two PRs; caps and
selection gating one or two more. History and notifications are each their own epic.

## Questions for Derek

1. **Cap on entries per contest rather than squads per league?** Recommended: entries per
   contest.
2. **Free keeps this season's results visible**, past seasons paid? Recommended: yes.
3. **Three paid tiers or two?** Three gives room; two (Premium and Platinum) is simpler to
   explain. Recommended: start with two, add Pro if the gap feels too wide.
4. **Paid tracking checkbox in scope?** It records payments, it does not take them.
5. **Try a Majors pass and a first-contest trial?** Both cheap once the model exists.

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
