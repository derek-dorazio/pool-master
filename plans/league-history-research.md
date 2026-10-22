# League history: what other sites do

**Tracking issue:** #837

Written 2026-10-21 as a companion to the history design, now §5 of `plans/season-cups.md`. Derek asked for research into how
office-pool and fantasy sites show league history, a few Poolmaster concept mockups drawn from
it, and a comparison with the history design as it stood then. `plans/season-cups.md` is the design of
record; this file is input to it and goes when #837 closes.

The cloud session could search the web but could not open the sites themselves, so there are no
screenshots. The descriptions below come from the sites' help pages, announcements and reviews
as quoted in search results.

## 1. What the sites do

| Site | History features | What stands out |
|---|---|---|
| ESPN Fantasy | League > History, with a year dropdown (the "Almanac") showing past winners, full standings, weekly scores and the draft for each season. A Trophy Case with all-time records and past seasons sits on the user's profile, not the league | The year picker. ESPN removed history in 2019 and brought it back after complaints, which says how much leagues care |
| Yahoo Fantasy | History tab of past standings, enabled by the commissioner; Trophies and Medals tabs on the user's profile; a Record Book (best and worst single-game marks, top scorers over time, season achievements), added to the mobile app in August 2026 | Medals per user across every league they play in. Best and worst marks side by side |
| Sleeper | League History: champions, all-time standings, weekly and player high scores, playoff brackets. Commissioner can type in past winners or import a league from another site. Weekly Reports post automatic awards to the league chat "for bragging rights or ribbing" | Commissioner-entered past winners (leagues are older than the app). Awards pushed into the chat |
| OfficePoolStop | New for 2026: Hall of Fame pages for five pool formats (pick'em, confidence, survivor, bookie, margin): championships, career wins, win percentage, strength of victory, record seasons, for one league and across the site. Credits legacy history from before the current platform. Margin pools also get a **Hall of Lame** | The closest office-pool equivalent, and the Hall of Lame |
| RunYourPool / OfficeFootballPool / Splash | Owned by Splash since 2021, now one brand. Search found no league-history or past-champions feature | Nothing to copy |
| Office Golf Pool Manager, MajorsPool | Season-long standings across every tournament in a golf season, alongside each tournament's own standings. No multi-year history found | Season-long totals are the cups feature, not history |
| Third-party history sites (League Legacy, Fantasy Record Book, The Sunday Chronicle, League Tycoon, ffwrapped) | Built on top of ESPN, Yahoo and Sleeper data: per-manager dossiers, lifetime head-to-head against every other manager, champions walls, droughts, trophy cases of 1st/2nd/3rd counts, season recaps | A whole category exists because the big sites' history is thin. Head-to-head and dossiers are what people pay for |
| Real office leagues | A physical perpetual trophy with a plate engraved for each year's winner, kept for 40+ years in some leagues | The perpetual trophy is the emotional centre of a long-running league |

Sources: ESPN's Fantasy 101 league pages guide and fantasyhoff.com's ESPN history guide; Yahoo
help articles SLN22671 and SLN6898 and the Fantasy Nerds report of 2026-08-16; Sleeper's support
article "League History and Weekly Reports" and blog post "League History and Weekly Reports with
Awards"; OfficePoolStop's blog post "What's New at OfficePoolStop for 2026"; Splash's acquisition
announcement; officepools.com and majorspool.com; leaguelegacy.io, fantasyrecordbook.com,
thesundaychronicle.app, leaguetycoon.com, ffwrapped.com.

## 2. Patterns worth taking

1. **Champions first.** Every site leads history with who won. Poolmaster's past-contests list
   with a winner line (slice 1) is the right first slice.
2. **A year picker over a season page.** ESPN's Almanac is the most-used history view in
   fantasy. It maps directly to the plan's Season page.
3. **Perpetual trophies.** A contest that recurs every year (the Masters pool, the survivor pool)
   gets one trophy with a plate per year. The plan's Q4.2 key, the event series, is exactly what
   links the plates.
4. **Best and worst together.** Yahoo's record book and OfficePoolStop's Hall of Lame show that
   the bad records are as much fun as the good ones. All of them can be finish-based.
5. **Head to head.** The most-requested feature on third-party sites. In a pool there are no
   matchups, but "who finished higher in contests both entered" works from frozen standings.
6. **Commissioner-entered past winners.** Sleeper and OfficePoolStop both let older history in.
   Poolmaster leagues often pre-date the app.
7. **Pushed recaps.** Sleeper's weekly awards and season Wrapped cards bring people back; a
   history page nobody visits does not.

## 3. Concepts

Three mockups, each published as a private page:

- **A. The Trophy Room**: season banners, perpetual trophies with engraved plates, and a trophy
  shelf on each team page. <https://claude.ai/artifact/KEg9wLCg7oATFGnHZFzPJd>
- **B. The Almanac and Record Book**: year picker, contests with winners, season table, and a
  record book split into Hall of Fame and Hall of Lame.
  <https://claude.ai/artifact/6pjUsEXZp4ZwTv4ogFRHJs>
- **C. Dossiers, Rivalries and Season Wrapped**: a team career page with a finish strip across
  the years, head to head against every other team, and an end-of-season awards card.
  <https://claude.ai/artifact/GBUAzGr5gTH9TptDNpziXk>

## 4. Against the first history design

The plan's model holds up: every concept is built from frozen standings, finish-based measures
and the event-series key. Nothing here needs a summary table or score-based records.

**Fits the plan as is**

- Concept B is the plan's Season page and Record book with two extra record types.
- The finish strip in C is the plan's team history list (slice 3) drawn as squares.
- Co-champions, renamed teams shown by their entry name, and "No result" for cancelled contests
  all appear in the mockups exactly as the plan describes them.

**Worth adding**

- **Perpetual trophies (A).** A trophy page per event series, with a plate per year. It reuses
  the Q4.2 key and the back-to-back record. Fits in slice 5. Only new data: an optional trophy
  name per series, defaulting to the series name.
- **Hall of Lame (B).** Longest drought, most runner-up finishes, most last places, earliest
  survivor exit. All finish-based, so it is two or three more `HistoryRecordType` values and a
  league setting to hide it. Fits in slice 5.
- **Head to head (C).** Derivable from standings with one query per team. A new endpoint on the
  team history page, best as its own slice after slice 3. Show only rivals with five or more
  shared contests.
- **"Next best" under each record (B).** Return the top two holders, not one.

**Differs from the plan**

- **Season banners name the season's most wins (A).** That is not a season champion, and the plan
  rightly leaves a true champion to the season-long cups feature (Q7.2). Banners should wait for
  that, or say "most wins" plainly.
- **Season Wrapped (C)** needs a per-member "seen" flag and a push moment. It is engagement, not
  history; a later ticket, after the cups feature defines a season's end.
- **Commissioner-entered past winners** (Sleeper, OfficePoolStop) is not in the plan. Entering
  results for contests that never ran in Poolmaster needs a new "historical result" record,
  which the plan's read-only model avoids. Recommend leaving it out of #837 and raising it only
  if leagues ask.
