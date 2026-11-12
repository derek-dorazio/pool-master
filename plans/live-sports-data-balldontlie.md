# Live Sports Data from BALLDONTLIE

Agreed with Derek on 2026-11-09 (project thread "Find sports data providers brief"). The
provider choice and its reasoning are in
`requirements/product-requirements/features/sports-data-providers/overview.md`. This plan
covers how the site takes live data from BALLDONTLIE, and in what order. Epic #1494. No implementation
starts until Derek says so.

How the built pieces fit together, league by league (the rows each needs, the triggers, the write
path and the key files), is `docs/LIVE-SPORTS-DATA-SYNC.md`; it outlives this plan.

## What we are building

Today every real score on the site is entered by an admin or loaded from a data file. The
only adapter behind the `SportDataProvider` port is the mock contest feed. Live golf has a
scheduled poll (`ingestion-scheduler`), and the only live-score category was `GOLF`.

The target:

1. **One BALLDONTLIE adapter** behind the existing port, registered in `provider-bindings`
   beside the mock. It reads the REST API with a key from AWS Secrets Manager (SDP-010).
   Every bound provider is registered: the default is each sport's primary (catalog browse
   and new links start with it), and every sync runs against the provider its event is
   linked to. So on QA the mock and BALLDONTLIE both serve golf, and the admin pages offer
   a provider choice wherever two cover a sport.
2. **Three kinds of data** it feeds into the scoring code that already exists:
   - golf hole-by-hole scores, through the existing `GOLF` live-score category;
   - game scores and winners for brackets and pick'em, through `MatchResultService`, as the
     `GAME` live-score category: a match links to its provider game by `externalGameId`, on its
     event's own provider, and the sync makes that link itself, from the game's two teams. An
     NFL event is a scope of the vendor's games, a regular season week (`nfl-2026-week-12`) or
     a postseason (`nfl-2026-postseason`), and its teams map by prefixed ids (`nfl-team-12`). A
     provider participant with no mapping yet is linked to the site's one participant of the
     same sport and name (a team loaded from a data file), not created twice. NFL events take
     the calendar year they are played in as their event year, as the NFL data files do, so the
     2025 season's playoffs are 2026 events. The NCAA men's and women's basketball tournaments are
     each one event per season (`ncaab-2025-tournament`, `ncaaw-2025-tournament`), read from
     the vendor's bracket: PoolMaster's bracket starts at the round of 64, and First Four games
     carry no score, since their winners fill a place rather than play a match. A school's
     men's and women's teams share a name, so a provider team that names its league (its
     match keyword) links only to the site's team affiliated with that league. Premier League
     matchweeks are events too (`epl-2026-matchweek-11`), a season's matches grouped by round
     number; a matchweek forms no bracket, so a draw is a result. The World Cup's
     knockout bracket is an event per edition (`fifa-wc-2026-knockout`); a knockout game level
     after extra time carries its shoot-out's scores, and the writer names the winner by them
     (#1532). The College Football Playoff
     is not read yet: the vendor's college football games carry nothing that marks the
     postseason or the playoff. A best-of series (the NBA, WNBA, MLB and NHL
     playoffs) is one match of several games, so it links no game: its sport league names
     each round's length (`roundSeriesLengths`, the NBA's 7, 7, 7, 7), and each sync counts
     the final games between the series' two teams as wins, writing the wins so far as its
     live score and its result once a side has won more than half (#1545). A series league's
     reader therefore hands over every game of the event on each sync. The NBA's playoffs are
     the first (`nba-2025-postseason`, one event a season); the four series leagues share one
     mapping and reader (`series-playoffs.ts`), each supplying only its own reads. The NHL's
     (`nhl-2025-postseason`, played in 2026) are four rounds of best-of-seven series, read
     without box scores, so no NHL round is listed as an event until a Clutch Card needs one. MLB's
     postseason (`mlb-2026-postseason`) runs from the best-of-three Wild Card Series to the World
     Series, also without round events yet. The WNBA's
     (`wnba-2026-postseason`) shares basketball with the NBA, whose keyword its name holds, so
     the event picker matches a keyword in an event's name only as whole words;
   - per-player box scores for Clutch Cards, through `StatLineService`, as the `STAT_LINE`
     live-score category (#1497). The adapter numbers each game within the Clutch Card event
     (game N is round N, and each series' Game N shares it in a round of several series) and maps
     the vendor's stat fields to the stats the composites count. A star's line is found through
     the star's provider mapping, made when the stars are loaded from the provider; a player who
     is not a mapped star is left out. A live game's lines are stored in progress, and the sync
     is authoritative over an admin's line correction. Each playoff round of a series league is
     an event of its own (`nba-2025-postseason-round-4`, the NBA Finals), its field the round's
     teams' active players. A round and its players carry the round's name as their tour, and
     the Clutch Card leagues are keyed to it, so the NBA league imports only the season's
     playoffs and a star links to the one its league already holds. The vendor names no round, so a series' round is its depth in the
     bracket: 1 past the later of its two teams' previous series, a bye counting as none, which
     places MLB's seeded teams in round 2. An event holding a live game's line is not completed
     by the lifecycle sweep until that line is final (#1660).
3. **Webhooks as the trigger, not the record.** BALLDONTLIE posts a signed event (period
   ended, game ended, hole completed) to a receiver. The receiver checks the signature,
   ignores events for nothing we have linked, and queues a background job (#1439 framework).
   The job fetches the authoritative game, box score or scorecard over REST, saves it through
   the services above, and the debounced leaderboard rebuild follows. A duplicated, late or
   out-of-order delivery therefore cannot corrupt standings: the job always writes the
   provider's current state.
4. **A slow scheduled poll as the safety net**, for deliveries that never arrive, and a
   final reconciliation sync when a game or round ends.

Admins still author every event (ADR 0009). The provider only supplies data to events,
matches and games an admin has linked to it, and it never creates events or moves an
event's status.

## Linking

Events already carry `providerId` and `externalId`, and participants have
`ParticipantProviderMapping`. Two links are missing:

- **Matches.** `SportEventMatch` has no provider id, so a bracket or pick'em game cannot be
  tied to a BALLDONTLIE game. Ticket 2 adds it (a model change), with an admin action that
  matches a round's games to the provider's schedule by the two teams and the date and shows
  what it could not match.
- **Clutch Card games and stars.** Each game of a Clutch Card event links to a provider game
  the same way, and each star links to a provider player through
  `ParticipantProviderMapping`. Ticket 3 adds a "load stars from provider" action so the
  mapping is made when the stars are loaded rather than by name afterwards.

## Webhooks and the free plan

Webhook events beyond NBA game start and end need All-Access, and the free plan allows 5
requests a minute. So the order is:

- Build and test the adapter and every write path against past games (box scores and
  scorecards of finished events are real data, nothing scrambled). The free plan covers
  "basic" endpoints only; where a ticket needs stats it does not include, one league at the
  $39.99 GOAT tier for a month is the cheapest way in. Each ticket says which it needs.
- Build the receiver against **recorded, signed sample payloads** in test code.
- Take the **7-day All-Access trial** only when tickets 1 to 5 are merged, on a week with live
  NFL, college football, NBA and NHL games and a PGA TOUR event. Ticket 6 is that week's
  checklist. Buy All-Access ($299.99 a month, or about $2,830 a year) only if it passes.

## Order

1. #1495 BALLDONTLIE adapter and golf live scores (PGA TOUR first, since golf already has live sync).
2. #1496 Game scores for brackets and pick'em, with match linking.
3. #1497 Clutch Card box scores, with game and star linking.
4. #1498 Webhook receiver that queues the sync job.
5. #1499 Safety-net poll, reconciliation, and an alert when a live linked event goes quiet.
6. #1500 All-Access trial week: the live checks, then the buy decision.

Tickets 2 and 3 can run in parallel after 1. Ticket 4 needs 1 and at least one of 2 or 3.

## Decisions

Derek accepted every recommendation below on 2026-11-09.

- **Q1 (decided). Should a provider's final score complete a bracket match by itself?** Completing a
  match advances the winner and moves standings. Decided: yes, apply it when the
  provider marks the game final, since the admin can still correct or clear a result under
  the existing lock rules, and waiting for an admin brings back the person in the loop this
  work removes. Show the source ("from BALLDONTLIE") on the admin's results page. Each match
  records who set its result (#1531, 2026-11-11): an admin's correction stands, and a
  provider's later final that disagrees is logged, not written. Clearing it hands the match
  back to the provider. Admin entry is a stop gap for leagues with no feed.
- **Q2 (decided). Live scores for brackets.** Matches today hold only final results. Decided:
  store and show the in-progress score as well, read-only, so a bracket page can show a game
  live. Built (#1496 part 3b): a live game puts `IN_PROGRESS` and its score on its match with
  no winner, and the admin's bracket page shows it. Member pages show no game scores yet.
- **Q3 (decided). Polling cadence once webhooks run.** Decided: every 15 minutes for linked
  in-progress events (from 5), plus one reconciliation sync at each game end. Golf is the
  exception (Derek, 2026-11-11): a live tournament is polled every 2 minutes during a round,
  since it subscribes to no per-hole event.
- **Q4 (decided). Which webhook events to subscribe to.** Decided: game started, period ended
  (a soccer match's halftime) and game ended for each league the adapter reads; for golf,
  tournament started, round started, a player's round completed and tournament ended, but not
  each hole (Derek, 2026-11-11). No per-play events (scored, rebound): one game produces
  hundreds, and the job refetches the box score anyway. Built (#1498): a notification for a
  game or tournament linked to an in-progress event queues one sync of that event, due about a
  minute out under a dedupe key, so a burst queues one job; the key is released when a worker
  claims it. Delivery budget: a game sends about six notifications (start, three or four period
  ends, end) and a golf tournament a few hundred (each player's round, about 70 to 150 a
  round), so a full season of every covered league stays well under All-Access's 500,000
  deliveries a month.
- **Safety net (decided and built, #1499).** Decided (2026-11-12): while the webhook secret is
  set, each BALLDONTLIE event polls every 15 minutes, golf every 2 minutes while a round is
  under way; a game or tournament ending queues a reconciling sync 10 minutes later; and an
  event in play with no notification for longer than its league's normal gap (a period or half
  plus its break, 75 to 90 minutes, World Cup 150, MLB 210; 6 hours for a golf round before its first finisher) logs a
  warning that a CloudWatch alarm raises. A flat 20 minutes was dropped in review: a quarter
  alone runs longer. A weather delay or other long stoppage also sets off the warning. Start notifications also sync an event still `SCHEDULED` past its start, waiting six
  minutes for the lifecycle sweep, since a live score is only written to an event in progress.
  Not covered: a reconciling sync that runs after the lifecycle sweep has completed the event
  writes nothing, so a correction after the scheduled end still needs an admin.
- **Q5 (decided). LPGA.** BALLDONTLIE has no LPGA. Decided: LPGA stays on the pipeline (results
  after each round) for launch. Revisit Goalserve golf if LPGA live leaderboards matter.

## Out of scope

Paying for anything before the trial week, other providers (Goalserve stays the backup),
odds, finish-order sports (pipeline, SDP-013), and the leagues BALLDONTLIE lacks: LPGA,
college hockey, PWHL, NWSL and the Women's World Cup.
