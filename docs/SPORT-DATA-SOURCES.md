# Sport data sources

Where to get each sport's schedule and fields when loading real data with the
`load-sport-data` skill. The skill says how to gather, cross-check and load; this page says
where to look. Every fact loaded needs a primary and a second, independent source.

## The one feed for most sports: ESPN

ESPN's public JSON feed covers golf, auto racing, tennis and every team sport, in one shape:

```
https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard
```

- `?dates=2027` (or `20270101-20271231`) returns a season's calendar, events with name and
  start and end dates. Without it, the current week.
- It only carries a season once that season is near. On 2026-10-15, `?dates=2027` returned
  the 2026 calendar for NASCAR, IndyCar and Formula 1, so a schedule loaded the autumn before
  comes from the league site and Wikipedia, which list next season as soon as it is announced.
- The current event carries its competitors once the field is announced, so the same feed
  serves fields.
- It is public but undocumented: it can change without notice, and gives no venue for golf.
  The second source catches both.
- A cloud session cannot reach it (proxy 403). Fetch it with the "Fetch sport sources"
  workflow in `urls`.

For event lists and dates, ESPN is the primary everywhere it has the sport. Wikipedia's
season page ("2027 PGA Tour", "2027 Formula One World Championship") is the second source
for schedules in every sport: it lists every event with dates and venue on one plain page.
For fields, the second source is the league's own site, which usually fills its pages with
scripts, so it goes in `rendered_urls`.

## Per sport

*Checked* means a fetch returned what the table says. Anything else is a candidate: confirm
it with one fetch before building a file on it, and update this table either way.

### Supported

| Sport · sport league | ESPN path (`<sport>/<league>`) | Second source, schedule | Field: primary · second | Field is set | Checked |
|---|---|---|---|---|---|
| Golf · PGA TOUR | `golf/pga` | pgatour.com/schedule (rendered): course, city, purse; Wikipedia season page | ESPN competitors · pgatour.com field page (rendered) | Friday 5 p.m. ET before the event; recheck Tuesday | 2026-10-14: ESPN calendar (49 events, names and dates, no venue); pgatour.com schedule (course and city) |
| Golf · LPGA Tour | `golf/lpga` | lpga.com tournaments page (rendered); Wikipedia | ESPN competitors · lpga.com field page (rendered) | About a week before; recheck Tuesday | No |
| Auto racing · NASCAR Cup Series | `racing/nascar-premier` | Wikipedia season page (names, tracks, cities, dates); driveraverages.com/nascar/year.php?yr_id=2027 (dates and tracks). nascar.com, jayski.com, racing-reference.info, mrn.com and frontstretch.com refuse the fetch (403) | Entry list: nascar.com · jayski.com (both refuse the fetch; find another second source when the first field is due) | Entry list mid-week before the race | 2026-10-15: ESPN `?dates=2027` returned only the 2026 calendar; Wikipedia and driveraverages.com agree on 34 of 36 points races and differ on Richmond and New Hampshire. Race names and cities come from Wikipedia alone (driveraverages.com gives date and track). 2026-10-18: `dates=2026` returns the whole season, each race's full finishing order (`order`) but no grid; it matches Wikipedia's race pages and every winner |
| Auto racing · IndyCar | `racing/irl` | indycar.com schedule; Wikipedia | Entry list: indycar.com · Wikipedia race page | Entry list the week of the race | 2026-10-15: no 2027 schedule yet (Wikipedia: races TBA, season starts March 7); ESPN returned only 2026. 2026-10-18: `dates=2026` returns all 18 races with full finishing orders (no grid); the Indianapolis 500 matches its Wikipedia page |
| Horse racing · US Thoroughbred | None (ESPN has no racing calendar) | Primary: the race's own site (pegasusworldcup.com, kentuckyderby.com, preakness.com, belmontstakes.com, breederscup.com); second: Wikipedia's race page for venue and city. The race's site is often the only source for next year's date | equibase.com entries · the track's entries page; list runners in morning-line order | Post-position draw, usually 2 to 5 days before | 2026-10-14: pegasusworldcup.com (2027 date, Gulfstream Park); Wikipedia race page (venue, city). gulfstreampark.com's Pegasus page still showed 2026; equibase.com/stakes/calendar.cfm and stakes.cfm returned 404. 2026-10-15: Derby, Preakness and Belmont sites each match Wikipedia; breederscup.com has no 2027 date yet. 2026-10-18: each 2026 Triple Crown race's Wikipedia page has the full result (post position, jockey, odds, scratches); no second source for results was fetched |
| Auto racing · Formula 1 | `racing/f1` | formula1.com/en/racing/2027 (rendered): rounds, race names, weekend dates, country; Wikipedia season page: race dates, circuits, cities | formula1.com entry list · Wikipedia season page (driver line-up is set for the season) | Season line-up; confirm the week of each race | 2026-10-15: formula1.com and Wikipedia agree on all 24 rounds; circuits and cities come from Wikipedia alone. ESPN returned only 2026. 2026-10-18: api.jolpi.ca/ergast/f1/<year>/results.json (100 rows a page) has every finishing order and grid, matching ESPN's `racing/f1` scoreboard in every 2026 race |
| Cycling · UCI WorldTour, UCI Women's WorldTour | None useful | Primary: procyclingstats.com race calendar; second: the organiser's site (giroditalia.it lists every RCS race, letour.fr) or UCI's calendar, which uci.org/road/calendar offers only as a PDF the fetch workflow cannot read | procyclingstats.com start list · the race's site | Start list a few days before a Grand Tour | 2026-10-15: PCS has both 2027 calendars; RCS and letour.fr confirm seven races. Tour Down Under disagrees (tourdownunder.com.au 16 to 24 January, PCS 19 to 24). firstcycling.com refuses the fetch (403); Wikipedia has no 2027 season pages yet. 2026-10-18: procyclingstats.com refuses the fetch (403); Wikipedia's race pages give a Grand Tour's full general classification, a one-day race's top 10 |
| Running · World Marathon Majors (men), (women) | None | Primary: worldmarathonmajors.com/races (rendered); second: each race's site, Wikipedia | Elite field announcements on the race's site · World Athletics | Elite field announced weeks before | 2026-10-15: WMM directory has 2027 dates for Tokyo, Boston, London (two days), Cape Town, Sydney and Berlin, each matched by the race's site except Sydney (its site refused the fetch); Chicago and New York TBD there, Chicago's own site says October 10. 2026-10-18: each 2026 major's Wikipedia page gives the top 10 men and women |
| Basketball · NCAA men's and women's tournaments (bracket) | `basketball/mens-college-basketball`, `basketball/womens-college-basketball` (scoreboard with `dates=<YYYYMMDD>&groups=100`, one day per fetch: a date range is refused with a 400; each game carries its region and round note and each team its seed) | ncaa.com/march-madness-live/bracket; Wikipedia's tournament page | Bracket: ncaa.com bracket · ESPN tournament challenge bracket. Each team's region seed, each opening pairing, the First Four pairings; game times are announced later, round by round | Selection Sunday; times through the first week | 2026-10-18: ESPN and Wikipedia agree on every 2026 men's and women's pairing, seed, region and winner; two women's scores differ by a point or two (ESPN's kept). Wikipedia's raw wikitext (`action=raw`) parses cleanly. ESPN marks the women's first two rounds at the top-16 seeds' arenas as home games |
| American football · College Football Playoff (bracket) | `football/college-football` (scoreboard with `seasontype=3&groups=80`; every playoff game carries a "College Football Playoff" note, and `dates` did not narrow the 2025 postseason feed, so one fetch returns all of it) | Wikipedia's season playoff page (seeds, byes, pairings, scores) | Bracket: ESPN scoreboard (seeds as the playoff ranking, kickoffs, home side, campus or neutral) · Wikipedia (seeds 1 to 12, the top four on byes) | The final CFP rankings, the Sunday after conference championship weekend | 2026-10-18: ESPN and Wikipedia agree on every 2025-26 playoff game, kickoff, seed and score. ESPN marks the National Championship not neutral (Hard Rock Stadium is Miami's own); the file keeps it neutral, Indiana the designated home team |
| Basketball · NBA and WNBA playoffs (bracket) | `basketball/nba`, `basketball/wnba` (scoreboard with `dates=<YYYYMMDD>`, one day per fetch: a date range is refused with a 400; each game carries its series summary, and the NBA play-in games their "NBA Play-In" note) | Wikipedia's playoffs page (seeds, pairings, each game and each series' result) and the NBA play-in tournament page; basketball-reference.com standings and series | Bracket: Wikipedia (each conference's seeds 1 to 8, the WNBA's 1 to 8 overall) · ESPN scoreboard (Game 1 tip-offs, home side). The NBA's 7 and 8 seeds are play-in places until the play-in is played | The regular season's last day; the NBA play-in a few days later | 2026-10-18: ESPN, Wikipedia and basketball-reference.com agree on every 2025 NBA and WNBA series, Game 1 tip-off and seed; basketball-reference.com's WNBA playoffs page is a 404 |
| American football · NFL playoffs (bracket) | `football/nfl` (scoreboard with `seasontype=3&week=N&dates=<season>`; week 4 is the Pro Bowl, so the Super Bowl is week 5) | Wikipedia's season playoffs page (seeds, pairings, scores) | Bracket: ESPN scoreboard (pairings, kickoffs, home side) · Wikipedia (each conference's seeds 1 to 7). The Divisional and conference championship pairings are not in any file: the reseed sets each after the round before it | Final week of the regular season; each round's kickoffs during the week before | 2026-10-18: ESPN and Wikipedia agree on every 2025 season playoff game, kickoff and score; seeds from Wikipedia alone, consistent with ESPN's home teams |
| Hockey · NHL and PWHL playoffs, NCAA men's and women's tournaments (bracket) | `hockey/nhl`, `hockey/mens-college-hockey`, `hockey/womens-college-hockey` (scoreboard with `dates=<YYYYMMDD>`, one day per fetch; each college game carries its tournament round note). The PWHL is not on ESPN | NHL: its own feeds, `api-web.nhle.com/v1/playoff-bracket/<year>` (every series, its division seeds and games won) and `playoff-series/carousel/<season>/`. Wikipedia's playoffs or tournament page for every league (game-by-game boxes with dates and period scores); the PWHL's is "<year> Walter Cup playoffs" | Bracket: NHL feed · Wikipedia (NHL); Wikipedia · ESPN scoreboard (college: seeds, puck drops, periods); Wikipedia's playoffs page · its season page (PWHL). Series start times after the first round are on no fetched page | NHL: the regular season's last day. College: selection day. PWHL: after the top seed chooses its opponent | 2026-10-20: the NHL feed and Wikipedia agree on every 2026 series; ESPN and Wikipedia agree on every college game ESPN carries (it has no men's regional finals); the PWHL's series come from Wikipedia alone, its champion confirmed by the season page. Wikipedia's women's tournament and PWHL playoffs pages are redirects under their old names |
| American football · NFL regular season (one event per week, its games no bracket) | `football/nfl` (scoreboard with `seasontype=2&week=N&dates=<season>`) | FixtureDownload's season feed (`fixturedownload.com/feed/json/nfl-<season>`, every game's kickoff, home side and score, `RoundNumber` the week). Pro Football Reference answers the fetch workflow with 403, and nfl.com's schedule pages render no games | Week games: ESPN scoreboard (pairings, kickoffs, home side, neutral site) · FixtureDownload | The NFL publishes the next season's schedule in May | 2026-10-19: ESPN and FixtureDownload agree on every kickoff, home side and score of 2025 weeks 1 to 3 (48 games) |

Venue for golf comes only from the tour page, so it is a single-source fact: load it and say
so (the skill's cross-check step).

### Upcoming

| Sport · sport league | ESPN path | Second source, schedule | Field: primary · second | Field is set | Checked |
|---|---|---|---|---|---|
| Tennis · ATP, WTA (later) | `tennis/atp`, `tennis/wta` | atptour.com / wtatennis.com calendars; Wikipedia | Draw: the Slam's own site (ausopen.com) · ESPN | Draw the day or two before main draw starts | No |
| Team sports for pick'em: college football, NBA, men's college basketball, MLB, NHL, soccer | `football/college-football`, `basketball/nba`, `basketball/mens-college-basketball`, `baseball/mlb`, `hockey/nhl`, `soccer/<league code>` | The league's own schedule page; Wikipedia | Teams come with each game in the ESPN feed | Fixed with the schedule | No |

## Rankings

| Sport | Primary | Second |
|---|---|---|
| Golf, men | owgr.com | ESPN or the tour's FedEx Cup standings |
| Golf, women | rolexrankings.com | lpga.com CME standings |
| Tennis | atptour.com, wtatennis.com rankings | ESPN |
| Racing, cycling | Season standings on the league site | Wikipedia season page |
| Running (marathons) | worldathletics.org world rankings (marathon), loaded as each runner's `ranking` and `seedNumber` | The race's elite field announcement |

Odds are not loaded (the skill says why), so no odds source is listed.
