# Olympics

**Tracking issue:** #821 (deferred)

Can Poolmaster run Olympic pools with only the sports and contest types it already has? Mostly
yes. This plan maps each supported sport to its Olympic events, says what each needs, and lists
what doesn't fit. Questions sit under the section they belong to, each with a recommendation.

## The short answer

Derek's hypothesis holds: an Olympic competition is **a sport league per sport, men's and women's
separately, plus its participants and event data**, and the contest types work unchanged. One
thing besides the event data file: each league is reference data in a migration, as every league
since hockey and baseball has been. That migration carries:

- the league row, with its **round names** (the final is the "Gold medal game") and **tier
  count** where the sport's default doesn't suit an 8-team knockout;
- its **named contest templates** (one default per contest type, plus variations, per the
  contest setup convention);
- for basketball, the **period layout** only if it differs from the sport's (FIBA plays
  quarters, so it doesn't).

Then a test data file of the last Games as played: Paris 2024 for Summer, Milano Cortina 2026 for
Winter. That is the same "data only" shape #818 (soccer) and #820 (tennis) already describe.

Two small registry changes are the only code, and both use features being built anyway:

- **Hockey's shoot-out.** Olympic knockout games that stay level after overtime go to a shoot-out;
  the NHL, PWHL and NCAA never do, which is why the soccer plan left hockey's `shootout` null
  (soccer plan Q1.1). The Olympics are the competition that needs it. It is one entry on the
  hockey definition once #791 has merged.
- Nothing else. Every other sport below fits as it is.

What the Olympics do **not** need: no new contest type, no new scoring, no new participant type,
no cross-sport model. Each Olympic event is an ordinary event of one sport.

## How an Olympic league is laid out

- **One league per sport per gender**, named "Olympic Games (men)" and "Olympic Games (women)"
  under each sport. Names are unique per sport, so every sport can use the same two names. This
  follows the existing split (World Marathon Majors (men)/(women), NCAA Division I Men/Women, ATP
  and WTA).
- **One event series per Olympic competition**, recurring every four years: "Olympic men's
  basketball tournament", "Olympic men's road race". The league's current event year simply
  jumps four years.
- **Participants.** Individual sports reuse the players already on the site: the loader finds a
  player by key, then by name, and has them join the Olympic league, so Scottie Scheffler is the
  same golfer at the Masters and at the Olympics. Team sports add **national teams** as ordinary
  team participants ("United States", "Canada"). A men's and a women's "United States" in the
  same sport end up one participant affiliated with both leagues, exactly as UConn already is in
  NCAA basketball. That is harmless because a field belongs to one event.
- **Team tournaments: the knockout stage is the event.** Olympic team tournaments play groups,
  then a knockout of eight (hockey: twelve, the top four on byes). The bracket event is created
  once the groups finish and the pairings are known, as the soccer plan does for the World Cup.
  Roster pools, bracket pools, playoff survivor and squares all run on it. Seeds come from the
  official ranking after the groups (FIBA and IIHF both publish one; soccer uses the FIFA
  ranking, as decided for the World Cup).
- **Bronze medal games are left out**, as soccer's third-place match and tennis's bronze match
  are: the bracket model has no match a loser advances to (#793). The gold medal path is the
  whole bracket.

Questions:

- **Q1** One league per sport per gender, or one "Olympic Games" league per sport holding both?
  Recommendation: per gender, as every other sport does. Tier counts, round names and templates
  are per league, and men's and women's draws differ in size (LA28 soccer is 12 men's teams, 16
  women's). **Decided 2026-10-21 (Derek): per gender.**
- **Q2** Entries close at the first knockout game, so a team pool is open only for the two to
  four days between the groups and the quarter-finals. Accept that? Recommendation: yes. The
  alternative, an event spanning the groups, needs group standings deciding the bracket, which is
  new. Group-stage pick'em (below) covers the first week. **Decided 2026-10-21: accepted.**

## Summer Games (LA 2028, 14 to 30 July 2028)

| Sport | Olympic events | Shape on the site | Contest types | Fit |
|---|---|---|---|---|
| **Golf** | Men's and women's individual: 60 players, 72 holes, no cut | A golf tournament, exactly | Tiered, budget, random draw | Data only. A medal tie is a playoff, which golf already handles without changing to-par |
| **Tennis** | Men's and women's singles: 64 draws, 16 seeds | Tennis bracket of individuals | Everything tennis offers (after #704 slice 2) | Data only, already listed on #820 row 1 |
| **Basketball** | Men's and women's 5x5: 12 teams, groups, then a knockout of 8 | Bracket of national teams, quarters | Tiered, budget, random draw, bracket, playoff survivor, squares; pick'em on group games | Data only |
| **Soccer** | Men's (12 teams at LA28) and women's (16): groups, then a knockout of 8 | Bracket of national teams with shoot-outs | Same as basketball, with draw picks on group games | Data only, after #787 slice 3 (knockouts) and slice 5 (group matchdays) |
| **Cycling** | Men's and women's road race (one long one-day race on open roads, about 90 riders, the cycling event stars ride) and individual time trial | One-day race, finishing order | Tiered, budget, random draw | Data only. Road race in; time trial out (Q3) |
| **Running** | Men's and women's marathon | One race, finishing order | Tiered, budget, random draw | Data only. Fields of about 80, so tiers would hold more than the series' default |
| **Baseball, softball** | Six teams each | Format for LA28 not yet published | | Skipped (Q4) |
| **American football** | Flag football, men's and women's: six teams each, five a side | A league under American football, if it ends in a knockout | Bracket, roster pools | Skipped (Q5) |

Group-stage pick'em: basketball already offers pick'em, and soccer gets group matchdays in #787
slice 5. Each matchday is a week event of the Olympic league, as decided for the World Cup.
Hockey doesn't offer pick'em, and its group games can end in shoot-outs, which #791 refuses
outside a bracket, so hockey stays knockout only.

Questions:

- **Q3** Which individual events? Recommendation: golf, tennis singles, the road races and the
  marathon, the events with real followings and a star field. Add the two time trials too: they
  are the same shape and cost one event each. Leave track cycling, mountain biking, BMX, race
  walks and the 10,000 m out; they fit the race shape but nobody pools them. **Decided
  2026-10-21 (Derek): golf, tennis singles and the marathon are the priority; no time trials.**
  The men's and women's cycling road races go in with the Summer individuals (Derek
  2026-10-21: it fits with no changes, so it is just data).
- **Q4** Baseball and softball. Tokyo 2020 played groups and then a repechage, where a loser
  stays in, which needs #793. Recommendation: wait until the LA28 format is published (expected
  in 2027) and add them then only if the knockout is single elimination. **Decided 2026-10-21:
  skipped; low chance of use.**
- **Q5** Flag football. Six teams per gender, format not yet published; likely a round robin,
  then semi-finals and a gold medal game. Recommendation: wait for the format. If it ends in a
  knockout, it is a league under American football with two halves (`HALVES` exists) and a
  four-team bracket. Too small for anything but a bracket pool and squares on the final.
  **Decided 2026-10-21: skipped.**
- **Q6** Running's tiers: a marathon field of 80 against the series' four tiers of six (the last
  tier takes the rest). Recommendation: give the Olympic leagues a tier count of 5, so the last
  tier is not 60 runners deep; it is one column on the league row. **Decided 2026-10-21: as
  recommended.**

## Winter Games (French Alps 2030, February 2030)

| Sport | Olympic events | Shape on the site | Contest types | Fit |
|---|---|---|---|---|
| **Hockey** | Men's: 12 teams, groups, a qualification round for seeds 5 to 12, then quarter-finals. Women's: 10 teams, then a knockout of 8 | Bracket of national teams; the men's top four on byes, through play-in places as the NCAA women's bracket does | Tiered, budget, random draw, bracket, playoff survivor, squares | Data plus hockey's shoot-out entry |

That is the whole Winter list. Hockey is the only Winter sport in the registry.

Questions:

- **Q7** Start the men's event at the qualification round (12 teams, four on byes) or at the
  quarter-finals (8)? Recommendation: the qualification round. It is the bigger pool and play-in
  places already work. Whether the quarter-finals are reseeded is read from the source when the
  data file is written (`RESEED_BY_SEED` exists for the NFL). **Decided 2026-10-21: as
  recommended.**
- **Q8** Which Games first? Recommendation: build the Milano Cortina 2026 hockey test seed first,
  since it is the most recent and needs only hockey, which exists. The Summer leagues can follow
  in any order before LA28; nothing is urgent until then. **Decided 2026-10-21 (Derek): build
  the leagues and the last-Games test seeds and check them in QA; the real LA28 (and 2030) data
  is loaded when those Games are set up.**

## Not in this work (needs new features)

- **Medal-count pools**, the classic Olympic office pool: draft or pick countries and score their
  medals across every sport. Needs countries as participants spanning sports and a medal table.
  The most common Olympic pool, and the one real gap. **Decided 2026-10-21: out of scope.**
- **Bronze medal games** (#793 shape: a loser advances).
- **Golf mixed team** (new at LA28: a man and a woman per country), **tennis doubles**, and any
  pair as a participant.
- **3x3 basketball**: a round robin of eight before its knockout; nothing plays a round robin.
- **Heats** in track, swimming and track cycling: a field cut down across rounds before the
  final. Judged events (gymnastics, diving, figure skating) score by marks, not order.
- **Sports not in the registry.** Summer: swimming, athletics track and field, volleyball (#799),
  rugby sevens (#794), cricket (#795), lacrosse (#801), water polo, handball, field hockey,
  triathlon, and the rest. Winter: alpine and cross-country skiing, biathlon, speed skating,
  luge, bobsleigh, curling and the rest. The timed races among them fit the finishing-order
  family, so each would be a new sport through the `add-sport` skill, not a new feature, if one
  is ever wanted.

## Slices

As listed on #821, each one PR of reference data and test data:

1. Winter hockey (men's and women's), with hockey's shoot-out entry. Needs #791.
2. Summer individuals: golf, the marathon and the cycling road race.
3. Summer basketball, with squares on the gold medal game.
4. Summer soccer. Needs #787 slice 3; group matchdays need slice 5.
5. Summer tennis singles. Needs #704 slice 2.
