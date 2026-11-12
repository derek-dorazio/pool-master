# Live Sports Data from BALLDONTLIE

Agreed with Derek on 2026-11-09 (project thread "Find sports data providers brief"). The
provider choice and its reasoning are in
`requirements/product-requirements/features/sports-data-providers/overview.md`. This plan
covers how the site takes live data from BALLDONTLIE, and in what order. Epic #1494. No implementation
starts until Derek says so.

## What we are building

Today every real score on the site is entered by an admin or loaded from a data file. The
only adapter behind the `SportDataProvider` port is the mock contest feed. Live golf has a
scheduled poll (`ingestion-scheduler`), and the only live-score category is `GOLF`.

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
     reader therefore hands over every game of the event on each sync;
   - per-player box scores for Clutch Cards, through `StatLineService`.
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
  in-progress events (from 5), plus one reconciliation sync at each game end.
- **Q4 (decided). Which webhook events to subscribe to.** Decided: game started, period ended,
  game ended, and golf hole completed and round completed. No per-play events (scored,
  rebound): one game produces hundreds, and the job refetches the box score anyway. At that
  level a full season of every covered league stays well under 500,000 deliveries a month.
- **Q5 (decided). LPGA.** BALLDONTLIE has no LPGA. Decided: LPGA stays on the pipeline (results
  after each round) for launch. Revisit Goalserve golf if LPGA live leaderboards matter.

## Out of scope

Paying for anything before the trial week, other providers (Goalserve stays the backup),
odds, finish-order sports (pipeline, SDP-013), and the leagues BALLDONTLIE lacks: LPGA,
college hockey, PWHL, NWSL and the Women's World Cup.
