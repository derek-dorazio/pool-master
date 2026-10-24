# Stat pools: expansion ideas

**Tracking issue:** #932 (research only, no tickets yet)

Written 2026-10-24 for Derek's question: which other sports, leagues and events suit
championship stat pools? The format is in `plans/championship-stat-pools.md`: each game is a
round, each player is a participant, and one composite stat per sport is the score, higher
better. Built so far: **Box Score** (MLB), **Triple Threat** (NBA), **Power Play** (NHL),
**Redzone** (NFL), championship rounds only.

---

## TL;DR

- **Best fits:** events with a few games, stars everyone knows, and a stat line per player per
  game. Soccer knockouts, college Final Fours and the College Football Playoff all qualify.
- **Cheapest wins reuse a composite we already have:** NCAA Final Four (Triple Threat), College
  Football Playoff (Redzone), WNBA Finals (Triple Threat). Each is a sport league, its setups
  and a test data file.
- **Soccer needs one new composite.** Proposal: **Hat Trick** = 3 × Goals + 2 × Assists + Shots
  on target, outfield players only.
- **Full playoffs** (every round, not just the final) are the most fun and the most data. Wait
  for the live provider (#938, #939); loading 40 to 85 box scores by hand per sport is too much.
- **Rugby and cricket** fit well but are new sports with a mostly non-US audience. Later.
- **Recommended order** is in section 4, by calendar: CFP in January, Final Four in April,
  Champions League in May, Women's World Cup in June.

**Effort scale:** **XS** = new sport league, setups, test data file. **S** = XS plus a new box
score source. **M** = a new composite or a bracket-shaped field. **L** = a new sport, or many
games to load before the live provider.

---

## 1. Soccer

**Composite: Hat Trick** (proposal, Q1). 3 × Goals + 2 × Assists + Shots on target, per match.
Outfield players only, no goalkeepers, as hockey leaves out goalies. Every input is a whole
number that every box score carries. A defender who plays well but never shoots scores little;
that is the same trade the NHL's Power Play makes. Extra time counts; a shoot-out does not.

**Data:** ESPN already gives every soccer competition's fixtures and results
(`docs/SPORT-DATA-SOURCES.md`). Its match summary should carry per-player goals, assists and
shots on target, but this is **untested** (the cloud session cannot reach ESPN; the "Fetch sport
sources" workflow can). Second source to pick when the first file is built (FBref or the
competition's own match centre).

| Event | When | Shape | Fit | Effort |
|---|---|---|---|---|
| **Women's World Cup** (Brazil) | Jun–Jul 2027 | Round of 16 to final, 16 matches | High: national stars, US interest | M (composite) |
| **Champions League** knockouts | Feb–May 2027 | Semis (4 legs) + final = 5 matches; or quarters onward = 13 | High: the best club players | S once Hat Trick exists |
| **MLS Cup** | early Dec 2026 | One match, like the Super Bowl | Medium: one game, small field | S |
| **Euro 2028** (UK and Ireland) | Jun–Jul 2028 | Round of 16 to final | High | XS once Hat Trick exists |
| **Copa América** | next edition, date to confirm | Quarters to final | Medium | XS |
| **Men's World Cup 2030** | Jun–Jul 2030 | Round of 32 to final (48-team format), 32 matches | Highest of all | M (many matches; wants the live provider) |

The 2026 men's World Cup is over; its knockouts would make a good test data file for Hat Trick.

---

## 2. Other sports and events

| Event | When | Composite | Data source | Fit | Effort |
|---|---|---|---|---|---|
| **College Football Playoff**, semis + National Championship | Jan 2027 | Redzone (QB/RB/WR/TE) | ESPN `football/college-football` (bracket feed checked 2026-10-18); nflverse has no college data | High: same week as the NFL's Championship Weekend | S |
| **NCAA men's and women's Final Four** | Apr 2027 | Triple Threat | ESPN college basketball summaries; ESPN bracket checked 2026-10-18 | High: two rounds, four teams, a player on a losing semifinalist scores one game only | S |
| **WNBA Finals** | Sep–Oct 2027 | Triple Threat | ESPN `basketball/wnba` (bracket checked) | Medium-high, growing audience | XS (reverses Q8) |
| **March Madness**, whole tournament | Mar–Apr 2027 | Triple Threat | ESPN, 67 games | High interest, but ~900 players and 67 box scores | L before the provider |
| **Full MLB/NBA/NHL/NFL playoffs** | each postseason | the sport's own | MLB Stats API, ESPN, `api-web.nhle.com`, nflverse (all worked in #935) | High: picks from 12 to 16 teams, deep runs matter | L before the provider; S after |
| **Conference finals + finals** (middle option) | each postseason | the sport's own | as above | High | M |
| **Rugby World Cup** (Australia) | Oct–Nov 2027 | **Try Line** (proposal): 5 × Tries + Try assists + Clean breaks | ESPN carries rugby; player stats untested | Medium: small US audience | L (new sport) |
| **Cricket**: IPL playoffs, ODI World Cup (southern Africa) | May 2027; Oct–Nov 2027 | **Century** (proposal): Runs + 20 × Wickets + 10 × Catches | Cricsheet (free match files after each game); ESPNcricinfo | High for India and UK users, low in the US | L (new sport) |
| **Lacrosse**: NCAA Final Four, PLL Championship | May 2027; Sep 2027 | Goals × 2 + Assists + Ground balls | ESPN college lacrosse, untested | Low-medium, niche | L (new sport) |
| **Olympics** (LA 2028): basketball, soccer, hockey (2030) knockouts | Jul–Aug 2028 | each sport's own | ESPN, untested for Olympic box scores | High for basketball | XS each once `plans/olympics.md` leagues exist |

**Full playoffs versus the final.** The final is one matchup, so a pool is mostly a bet on
which team plays more games. Full playoffs add the real skill: picking players whose teams go
deep. Eliminated players simply stop scoring, as a golfer who misses the cut does. The data
cost is what holds it back: about 40 MLB, 80 NBA, 85 NHL and 13 NFL games a postseason. That
fits the live provider, not a workflow load per game.

---

## 3. What each new event needs

Nothing new in the model. Each event is a player-field sport league with its setups and its
last-season test data file (`rules/architecture-rules.md` §6), as #935 does for the first five.
A new composite adds a stat enum and a formula in the sport definition. A new sport goes
through the `add-sport` skill first.

---

## 4. Recommended order

1. **College Football Playoff semis + National Championship** (Jan 2027). Reuses Redzone, sits
   beside the NFL's first real load (#937), ESPN feed already checked.
2. **NCAA men's and women's Final Four** (Apr 2027). Reuses Triple Threat; two rounds show off
   the "your player's team lost" twist.
3. **Hat Trick + Champions League semis and final** (Apr–May 2027). One new composite opens
   all of soccer.
4. **Women's World Cup knockouts** (Jun–Jul 2027). Hat Trick reused.
5. **Full playoffs for all four leagues**, once the live provider is in (#939).
6. **WNBA Finals** (fall 2027), if Derek reopens Q8.
7. Later: Euro 2028, LA 2028 Olympics, men's World Cup 2030. Rugby and cricket only if
   Poolmaster wants a non-US audience.

MLS Cup in December 2026 is the earliest soccer tryout, but it only works if Hat Trick and the
stat pool screens (#936) are done by mid-November. Skip it unless they are.

---

## 5. Questions for Derek

- **Q1. Soccer composite.** *Recommend* **Hat Trick** = 3 × Goals + 2 × Assists + Shots on
  target, outfield players only. Simple, every box score has it, and the name is soccer's
  best-known feat.
- **Q2. College events.** The stat pools plan left college championships out. *Recommend*
  reopening for the CFP and the Final Fours: cheap (existing composites), big US audiences, and
  they fill January and April.
- **Q3. Full playoffs.** *Recommend* adding them only after the live provider, as their own
  epic.
- **Q4. WNBA Finals.** Q8 said no WNBA. *Recommend* leaving it for fall 2027 and asking again
  then; it is the cheapest of all to add.
