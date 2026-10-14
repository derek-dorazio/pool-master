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
| Auto racing · NASCAR Cup Series | `racing/nascar-premier` | nascar.com schedule; Wikipedia | Entry list: nascar.com · jayski.com | Entry list mid-week before the race | No |
| Auto racing · IndyCar | `racing/irl` | indycar.com schedule; Wikipedia | Entry list: indycar.com · Wikipedia race page | Entry list the week of the race | No |
| Horse racing · US Thoroughbred | None (ESPN has no racing calendar) | Primary: the race's own site (pegasusworldcup.com, Breeders' Cup, Churchill Downs); second: Wikipedia's race page for venue and city. The race's site is often the only source for next year's date | equibase.com entries · the track's entries page; list runners in morning-line order | Post-position draw, usually 2 to 5 days before | 2026-10-14: pegasusworldcup.com (2027 date, Gulfstream Park); Wikipedia race page (venue, city). gulfstreampark.com's Pegasus page still showed 2026; equibase.com/stakes/calendar.cfm and stakes.cfm returned 404 |

Venue for golf comes only from the tour page, so it is a single-source fact: load it and say
so (the skill's cross-check step).

### Upcoming

| Sport · sport league | ESPN path | Second source, schedule | Field: primary · second | Field is set | Checked |
|---|---|---|---|---|---|
| Auto racing · Formula 1 (#625) | `racing/f1` | formula1.com/en/racing/2027 (rendered); Wikipedia | formula1.com entry list · Wikipedia season page (driver line-up is set for the season) | Season line-up; confirm the week of each race | No |
| Cycling (#626) | None useful | Primary: procyclingstats.com race calendar; second: the race's site (letour.fr) or UCI calendar | procyclingstats.com start list · the race's site | Start list a few days before a Grand Tour | No |
| Running · World Marathon Majors (#627) | None | Primary: worldmarathonmajors.com; second: each race's site, Wikipedia | Elite field announcements on the race's site · World Athletics | Elite field announced weeks before | No |
| Tennis · ATP, WTA (later) | `tennis/atp`, `tennis/wta` | atptour.com / wtatennis.com calendars; Wikipedia | Draw: the Slam's own site (ausopen.com) · ESPN | Draw the day or two before main draw starts | No |
| Team sports for pick'em: NFL, college football, NBA, men's college basketball, MLB, NHL, soccer | `football/nfl`, `football/college-football`, `basketball/nba`, `basketball/mens-college-basketball`, `baseball/mlb`, `hockey/nhl`, `soccer/<league code>` | The league's own schedule page; Wikipedia | Teams come with each game in the ESPN feed | Fixed with the schedule | No |

## Rankings

| Sport | Primary | Second |
|---|---|---|
| Golf, men | owgr.com | ESPN or the tour's FedEx Cup standings |
| Golf, women | rolexrankings.com | lpga.com CME standings |
| Tennis | atptour.com, wtatennis.com rankings | ESPN |
| Racing, cycling | Season standings on the league site | Wikipedia season page |
| Running (marathons) | worldathletics.org world rankings (marathon), loaded as each runner's `ranking` and `seedNumber` | The race's elite field announcement |

Odds are not loaded (the skill says why), so no odds source is listed.
