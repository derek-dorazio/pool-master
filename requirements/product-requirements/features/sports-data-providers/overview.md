# Sports Data Providers — Business Brief

Refreshed 2026-10-28. It replaces the May 2026 brief, which covered golf, NCAA, the World
Cup and tennis only and picked Data Golf for golf. PoolMaster now runs contests on eleven
sports, playoff brackets, weekly pick'em, finish-order races and Clutch Card stat pools, so
the question is wider: which providers we need for **live stats, events and results**, and
whether the public-source load pipeline can carry the site long term. Open questions, each
with a recommendation, are in [open-questions.md](./open-questions.md).

Pairs with [`contest-event-feed-integration`](../contest-event-feed-integration/overview.md).

## How sure each fact is

The research session could search the web but could not open vendor sites (datagolf.com,
sportsdata.io and the-odds-api.com were outside its network). Each fact is marked:

- `(Vendor)`: the vendor's own page or docs, as shown in search results.
- `(Reported)`: a third-party review or comparison, often a competitor's. Treat as an estimate.
- `(Unverified)`: inferred or not found; confirm with one call or a sales question.

Prices for every provider that sells through sales are quotes we have not asked for yet.

## The answer in short

1. **We have no real provider today.** The `SportDataProvider` port has one adapter, the mock
   feed. Every real score on the site comes from a data file loaded by hand or an admin
   entering it. That works for QA. It cannot run a live leaderboard on a Sunday afternoon.
2. **The public-source pipeline should become test data plus a gap filler, not the live
   path.** It is the right tool for test data, season schedules, and the low-frequency
   results-only sports no affordable provider covers (horse racing, marathons, cycling). It
   is the wrong tool for anything live or per game. See *Is the public-source pipeline viable
   long term?* below.
3. **Pick one multi-sport provider for the live core, with a real test environment.**
   SportsDataIO fits best: it covers golf, NFL, college football and basketball, NBA, WNBA,
   MLB, NHL, NASCAR, soccer, MMA and tennis in one API shape, and its free trial plus free
   Replay let us build and test every binding before paying. Sportradar is the alternative if
   SportsDataIO's quote or coverage falls short; it covers more (every golf tour, college
   baseball and softball, every motorsport series) at enterprise prices.
4. **Correct the May pick.** Data Golf's terms limit its site and API to personal,
   non-commercial use `(Vendor)`. It cannot back a commercial site without a separate
   agreement, which it does not advertise.
5. **Spend nothing until we are close to production.** Build against trials and replays now;
   ask for quotes now (they take weeks); sign when the production plan (epic #917) moves.

## What we need from a provider

The product shapes the ask. Per ADR 0009, an admin authors every event and a provider only
supplies data to an event an admin has linked. So the feeds are:

| Feed | When it runs | What it carries | Must be live? |
|---|---|---|---|
| Event lookup | Admin browses or imports a season | Name, dates, venue, the games of a round | No |
| Field | Admin loads or refreshes one linked event | Golfers, drivers, players, teams, seeds, rankings | No, but often Tuesday to the morning of |
| Live scores | Scheduled, every few minutes, for linked in-progress events | Hole by hole, lap or position, game score, period scores | **Yes** |
| Box scores | Scheduled during and after each game of a Clutch Card | Each player's stat line | **Yes** for live leaderboards; after the game at least |
| Results | When an event or game ends | Finishing order, winner, shoot-outs, retirements | Soon after, minutes not hours |

The live scores and box scores rows are what a provider is really for. The others can come
from either a provider or the pipeline.

### What each contest needs

| Contest family | Sports and leagues on the site | Live need | Stats |
|---|---|---|---|
| Stroke play (golf) | PGA TOUR, LPGA Tour, majors; planned LIV and DP World | Hole by hole, rounds, cut, withdrawals | Score to par, position |
| Finish order (racing) | NASCAR Cup, IndyCar, Formula 1, US Thoroughbred, UCI WorldTour (men, women), World Marathon Majors (men, women) | Running order for motorsport; final order for the rest | Finishing place, status, grid or post |
| Knockout brackets | NCAA men's and women's basketball, CFP, NFL, NBA, WNBA, NHL, PWHL, college hockey, MLB, World Cup, Women's World Cup, Euro, Copa América, Champions League, MLS, NWSL, NCAA soccer, Grand Slam and NCAA tennis | Game score, final, shoot-outs, retirements | Winner, score, period scores |
| Weekly pick'em | NFL regular season, Premier League | Game score, final | Winner, score, spread set by admin |
| Clutch Card stat pools | CFP semifinals and title game, NFL Championship Weekend and Super Bowl, men's Final Four and title game, NBA conference finals and Finals, WNBA semifinals and Finals, NHL conference finals and Stanley Cup Final, men's Frozen Four, LCS and World Series, Champions League semifinals and final, Women's World Cup semifinals and final | **Per player, per game, ideally live** | Points, rebounds, assists; goals, assists, shots on goal; passing, rushing, receiving yards and touchdowns, receptions; total bases, runs, RBI, walks, stolen bases |

Deferred or planned, which a provider choice should not rule out: PWHL Clutch Card (#1046),
women's Final Four and Frozen Four (#1052), earlier playoff rounds (#1049), college baseball
(#1050), softball (#1051), rugby (Six Nations, Rugby World Cup 2027), UFC card pick'em, NCAA
women's volleyball, the Olympics, Indian Wells and Miami, Liga MX and the Gold Cup, the
College World Series.

## Candidate providers

### Enterprise, official feeds

| | SportsDataIO | Sportradar |
|---|---|---|
| Coverage | NFL, college football, college basketball, NBA, WNBA, MLB, NHL, golf, NASCAR, soccer, MMA, tennis; "13 sports" `(Vendor)`. LPGA, F1, women's college basketball, PWHL `(Unverified)` | NFL, NCAA football, NCAA men's and women's basketball, NBA, WNBA, MLB, NHL, soccer, tennis, MMA `(Vendor)`; golf hole by hole for PGA TOUR, DP World, LIV and LPGA `(Vendor)`; NASCAR, F1, IndyCar, MotoGP `(Vendor)`; NCAA baseball and NCAA softball `(Vendor)`. PWHL and women's college hockey not found `(Unverified)` |
| Live | Real-time on a commercial production key `(Vendor)` | Real-time and push feeds on production keys `(Vendor)`; NASCAR feeds partly not real-time `(Vendor)` |
| Box scores | Per-player game stats in every team sport `(Vendor)` | Per-player game stats, play by play `(Vendor)` |
| Price | Not published for commercial real-time. Reviews cite $250 to $1,000+ a month `(Reported)`. Its $99 to $149 a month "Discovery Lab" tiers are next-day data, not licensed for commercial redistribution `(Vendor)`, so they do not fit | Not published. Reviews and competitors cite five figures a year minimum, some $10,000+ a month `(Reported)` |
| Licensing | Commercial agreement through sales `(Vendor)` | B2B contract through sales; not meant to be called from a client app `(Vendor)` |
| **Test environment** | **Yes, free.** A free trial key, every endpoint, with scores and stats scrambled 5 to 20 % but names, schedules, teams and players real `(Vendor)`. **Replay**, free, replays real API output of past events at a chosen start time, nothing scrambled `(Vendor)`: the best way to test a live leaderboard end to end | **Yes, free but short.** A self-issued trial key per sport, 30 days, 1,000 requests and 1 per second `(Vendor)`; trial keys serve historical and replay data `(Vendor)`. Some products need a sales rep for a trial `(Vendor)` |

### Low-cost, self-serve

| Provider | Coverage | Price | Test environment | Fit |
|---|---|---|---|---|
| **API-Sports** (api-football, api-basketball, api-nba, api-hockey, api-baseball, api-american-football and others) | Team sports worldwide, 1,100+ soccer competitions `(Vendor)`; also NFL and college football, NBA, hockey, baseball `(Vendor)`. No golf or racing finish orders that we found `(Unverified)` | Per sport: free 100 requests a day; Pro $15, Ultra $25, Mega $35 a month `(Vendor)` | **Yes**: the free plan is the same API with a daily cap `(Vendor)` | Cheapest live scores for brackets and pick'em. Player box-score depth for Clutch Cards varies by sport `(Unverified)`: check NBA, NHL, MLB, NFL player game stats on the free plan before relying on it |
| **Goalserve** | Golf (PGA leaderboard, rankings; LPGA listed), tennis (ATP, WTA, Challenger, ITF), horse racing (US entries, results), most team sports `(Vendor)` | Golf $200 a month or about $1,500 a year; tennis $150 a month; full package $800 a month `(Vendor, prices vary by page)` | **Yes**: 30-day free trial of any package, full data `(Vendor)` | The one self-serve option with **US horse racing entries and results**. A golf fallback if SportsDataIO's golf quote is high |
| **BALLDONTLIE** | NBA, NFL, MLB, NHL, WNBA, EPL, college football and basketball, MMA `(Vendor)` | Free (teams, games); $9.99 to $39.99 a month per sport with stats; $159.99 all sports `(Reported, Nov 2025)` | **Yes**: free tier | Cheap per-player stats for Clutch Card leagues it covers; small vendor, no SLA |
| **The Odds API** | Odds for 70+ sports, plus a scores endpoint `(Reported)` | Free 500 credits a month; $30 to $249 a month `(Reported)` | **Yes**: free tier | Only if we decide to load odds for tiers (Q SDP-003). Not a stats provider |
| **Data Golf** | Every major tour, live scoring, fields, odds | $30 a month (Scratch PLUS) `(Vendor, May 2026)` | Yes, the subscription key | **Not usable commercially**: terms say personal, non-commercial use only, no redistribution `(Vendor)` |
| **OpenF1** | Formula 1 timing and results | Historical free; live needs a small paid sponsor tier `(Reported)` | Yes, historical | F1 only; terms for commercial use not found `(Unverified)` |

### Not a provider, but free and official

- **MLB Stats API** and the **NHL API** (`api-web.nhle.com`): official, keyless, complete. MLB
  stamps every response with an MLB Advanced Media copyright notice that points to its
  terms, which third parties read as personal, non-commercial use `(Reported)`. No terms
  found for the NHL feed `(Unverified)`.
- **ESPN** (`site.api.espn.com`): undocumented, keyless, covers almost everything. No
  published usage rights; nothing licenses it for a commercial product `(Reported)`.

### Sports no affordable feed covers

Equibase is the official US horse racing database; entries and results are free to view,
and a commercial licence is needed to use its data in a fantasy product `(Reported)`. No
public API or price list `(Unverified)`. ProCyclingStats has no public API and no data
licence `(Reported)`. World Marathon Majors and the PWHL publish results on their own sites;
no feed found. These are results-only sports with one result per event (a finishing order),
which an admin can enter from two sources in minutes. They stay on the pipeline and admin
entry (see below).

## Recommendation

**Primary: SportsDataIO** for golf, NFL, college football, men's and women's college
basketball, NBA, WNBA, MLB, NHL, NASCAR, soccer and tennis.

- It covers the live core in one API shape, which means one adapter family behind the port
  rather than one per sport.
- Its free trial and Replay answer the "can we build without paying" question better than
  anyone: the trial for shapes and edge cases, Replay for running a whole real event (a golf
  Sunday, a Super Bowl box score) through our sync, scheduler and leaderboard. Replay output
  is real, so a test that passes against it means something.
- Ask its sales team for a quote covering the leagues above, production real-time, with
  commercial display rights for a contest site. Ask whether LPGA, F1, women's college
  basketball and the PWHL are in.

**Alternative: Sportradar**, if SportsDataIO's quote is out of reach or it lacks LPGA, LIV
or DP World golf, F1 or IndyCar, or college baseball and softball. Ask for a quote at the
same time; two quotes are leverage. Its 30-day trials are short, so start one only when an
adapter is ready to be built.

**Cheaper path, if both quotes are too high for launch:** API-Sports for team-sport scores
($15 to $35 a month per sport; NFL, NBA, NHL, MLB and soccer together about $100 to $175 a
month) plus Goalserve golf ($200 a month) plus BALLDONTLIE for Clutch Card box scores where
API-Sports is thin. Every one of them has a free tier or trial to build on. The cost is more
adapters to write and keep.

**Racing, cycling, running:** no provider for now. NASCAR (and F1 if covered) come with
SportsDataIO. Horse racing: Goalserve's 30-day trial is worth one evaluation when the
Triple Crown nears. The rest stay on the pipeline.

**Odds:** keep not loading them (the load skill explains why); tiers come from rankings
and admin judgement. Revisit only if a contest needs live odds (Q SDP-003).

### Rough monthly cost, production

| Path | Estimate | Confidence |
|---|---|---|
| Enterprise primary (SportsDataIO, the leagues above) | Several hundred to low thousands a month | `(Reported)`: needs the quote |
| Enterprise alternative (Sportradar) | Likely five figures a year or more | `(Reported)` |
| Cheaper path (API-Sports + Goalserve golf + BALLDONTLIE) | About $350 to $500 a month | `(Vendor)` list prices |
| Building and testing now | **$0** on every path | `(Vendor)` |

## Is the public-source pipeline viable long term?

**For test data, season schedules and the results-only sports: yes. For live stats,
box scores and most fields: no.** Recommendation: keep it, narrow its job, and connect a
provider for the rest.

What the pipeline is: the `load-sport-data` skill gathers facts from ESPN's public feed,
league sites and Wikipedia, cross-checks two sources, writes a data file, and the "Load
sport data" workflow applies it after Derek's go. "Fetch sport sources" runs on a branch
because cloud sessions cannot reach most sport sites.

Why it cannot carry the live site:

1. **Speed.** A live leaderboard needs scores every few minutes. The pipeline is a human,
   an agent and two workflows per update. A Clutch Card game ends at 11 p.m.; standings
   settle when someone wakes up.
2. **A person in every loop.** Each load needs Derek's go, and each fetch needs a workflow
   run, because the cloud cannot reach the sources. That does not scale past a handful of
   events a week, and it ties settlement to Derek's calendar.
3. **Rights.** Sports facts themselves are public (C.B.C. Distribution v. MLB Advanced
   Media, 8th Cir. 2007, held fantasy operators may use player names and stats without a
   licence `(Reported)`), but the feeds we read are not licensed to us. ESPN's is
   undocumented and carries no usage rights; MLB's response carries a copyright notice
   pointing to non-commercial terms. A paid site that depends on them for scores is
   exposed, and they can be cut off or changed without notice.
4. **Fragility.** The sources table already records ESPN shape changes, 403s from
   nascar.com, jayski.com and Pro Football Reference, a 1.5 MB cut-off on a tennis fetch, and
   one-day-per-fetch limits. Each is fine for a once-a-season load and a page-at-3-a.m.
   problem for live scores.

Why it stays:

- **Test data** is its best use: last season's real events, made into QA files, with no
  provider bill and no scrambling (`rules/architecture-rules.md` §6 *Manual-testing seed
  data goes through the admin API*).
- **Season schedules** are once a year per league, a few dozen facts, and an admin authors
  events anyway (ADR 0009). The pipeline or a provider's event lookup both work; the
  pipeline needs no adapter.
- **Results-only sports with no affordable provider** (horse racing, cycling, marathons, the
  PWHL, NCAA tennis): one finishing order per event, loaded or entered after the event.
  Nothing to stream.
- **Cross-checks:** a second source on a provider's field or result when an admin doubts it.

The split, per feed:

| Feed | Provider-covered sport | Sport with no provider |
|---|---|---|
| Event schedule | Provider event lookup (admin imports) or pipeline | Pipeline |
| Field | Provider, loaded by the admin on the linked event | Pipeline, just in time |
| Live scores | **Provider** | None (results only) |
| Box scores | **Provider** | Not offered (no Clutch Card there) |
| Results | **Provider** | Pipeline or admin entry, two sources |
| Test data | Pipeline (Replay for live testing) | Pipeline |

## How we get there, without paying first

1. Ask SportsDataIO and Sportradar for quotes now (Q SDP-007); a sales cycle takes weeks.
2. Take SportsDataIO's free trial key and build the first real adapter behind the existing
   port: golf live scores first, since stroke play already has its live sync and
   scheduler. Test against Replay of a real 2026 tournament.
3. Second adapter: team-sport box scores for the next Clutch Card round, tested on Replay of
   last season's round.
4. Then team-sport game scores for brackets and pick'em.
5. Sign the production agreement when the production plan (epic #917) is scheduled; the
   adapters swap the trial key for the production key, nothing else.

Each step is its own ticket; none is filed yet (Q SDP-008).
