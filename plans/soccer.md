# Soccer

**Tracking issue:** #787

Execution narrative for #787 (soccer) and its two shared prerequisites, #791 (shoot-outs) and
#792 (ties). The decisions behind it are recorded on #787. This plan says how the slices are cut,
what each one changes, and what is still open. Open questions sit under the slice they belong
to, each with a recommendation; none of them blocks starting slice 1.

## What changed since #787 was written

Hockey (#811) and baseball (#812) each landed as **one PR** carrying the sport, every
fixed-bracket league, the contest templates and a played test seed per league. So soccer
doesn't need a slice per kind of bracket: the bracket pools, roster pools, second-chance
brackets, playoff survivor and squares come with the sport for free. The `HALVES` period layout
already exists (college basketball), so squares need nothing new.

That gives five PRs instead of six slices, with the scenario-suite rows riding in each PR (as
hockey's did) rather than as a slice of their own:

1. **#791 shoot-outs** (shared, sport-agnostic).
2. **#792 ties** (shared, sport-agnostic). It can go in parallel with 1: they touch the same
   result request but different rules, so the second to merge just merges main.
3. **Soccer and its knockout tournaments**: the sport, the international leagues and the
   Champions League. Needs 1, because the played test seeds have shoot-outs.
4. **Club and college playoffs**: MLS, NWSL and the NCAA College Cups. Needs 1 too.
5. **League seasons and group matchdays**: Premier League pick'em and survivor, and group-stage
   matchdays. Needs 2 and 3.

Slices 3 and 4 can be one PR if the implementer finds 4 small, as hockey's four leagues were.

## Slice 1: a knockout match level after extra time (#791)

Today a result names a winner and both scores, and `describeScoreProblem` in
`match-result-service.ts` refuses a winner whose score isn't higher. Everything downstream reads
`winnerSide`, so only the write path changes.

- **Model:** two nullable integer columns on `SportEventMatch`, `homeShootoutScore` and
  `awayShootoutScore`, through `SportEventMatchDto` and the mapper.
- **Request:** `RecordSportEventMatchResultRequest` gains both, nullable and optional.
- **Rule:** in a match that forms part of a bracket, a level score needs both shoot-out scores,
  and the winner's must be the higher. Anywhere else, and in a sport without shoot-outs,
  shoot-out scores are refused (422 `MATCH_RESULT_INVALID`, as other score problems are). A
  level bracket score without them stays refused.
- **Sport definition:** a `shootout` entry, `{ label: 'pens' } | null`, says whether the sport
  settles a level knockout this way and what screens call it. Null for every sport today.
  Soccer sets it in slice 3. This slice tests it with a test-only definition.
- **Web:** the admin results form shows the two shoot-out boxes when a bracket match's scores
  are level and the sport has a shoot-out. The bracket and game screens show "1-1 (4-3 pens)".
- **Unchanged on purpose:** the tiebreaker (final's total points) and squares read the match
  score, which excludes the shoot-out (IFAB Law 10).

Questions:

- **Q1.1** Should hockey get `shootout` too? The NHL, PWHL and NCAA playoffs play overtime to a
  goal, so a playoff game never ends in a shoot-out. Recommendation: no. Hockey stays null until
  a hockey competition that uses one is added.
- **Q1.2** Should a result note ("ret.", "w/o") come with this? Recommendation: no. Tennis
  retirements and walkovers belong to the tennis ticket (#704), which can add what it needs.

## Slice 2: ties (#792)

Two halves: recording a tie, and picking one.

**Recording a tie.** `winnerSide` becomes nullable on the result request. Null means a tie, and
needs both scores, level. A tie is refused in a bracket match (a knockout always has a winner,
by shoot-out if it has to). It's allowed in any week of games, in every sport: an NFL tie is
recorded this way too. Pick'em already scores a team pick on a tie as wrong, and survivor already
puts the entry out (`survivor.ts`), so neither needs a change for this half. The admin form gets
a "Tie" choice (shown with the sport's word: "Draw" for soccer) on a week's game.

**Picking a tie.** `ContestEntryMatchPrediction` names a team (`sportEventParticipantId`,
required). A bracket pick can't be stored as a side instead, because the entry's predicted
teams aren't the real sides, so the team column stays:

- New enum `PredictedResult` (`TEAM`, `TIE`), with a Prisma enum and a `predicted_result`
  column (existing rows backfilled `TEAM`). `sportEventParticipantId` becomes nullable, with a
  check constraint: present when `TEAM`, null when `TIE`.
- `GamePickWrite` and `GamePickDto` gain `predictedResult`. `sportEventParticipantId` is
  nullable, and required when `TEAM`. Use a flat object with a refine, not a union: see the
  `removeAdditional` + `anyOf` gotcha in `rules/service-rules.md` §4.
- A tie pick is accepted only in a `PICK_EM` contest on a sport whose definition offers tie
  picks. Bracket and survivor refuse it.
- Scoring (`game-picks.ts`): a tie pick is CORRECT when the game ends level and BUSTED
  otherwise. Its value is 1 straight up, or its confidence value in a confidence pool.
- **Sport definition:** a `pickEm` entry, `{ tiePicks: boolean; againstTheSpread: boolean }`.
  Every current sport is `{ tiePicks: false, againstTheSpread: true }`. Soccer is
  `{ tiePicks: true, againstTheSpread: false }`. Contest create refuses against-the-spread for a
  sport without it. This is how "no spread pools for soccer" is enforced, rather than by leaving
  out templates.
- **Web:** a pick'em game row offers a middle "Draw" (the sport's word) button between the two
  teams when the contest's sport offers tie picks. Leaderboards and the picks view show it.
- **Vocabulary:** `tie: string` on the sport vocabulary ("Tie"; soccer "Draw").

Questions:

- **Q2.1** Name of the enum: `PredictedResult` (`TEAM`, `TIE`)? `PickOutcome` is taken: it
  already means CORRECT, BUSTED, PUSH or PENDING. Recommendation: `PredictedResult`. **Decided
  2026-10-21: `PredictedResult`.**
- **Q2.2** Can the week's tiebreaker game, or any game, be tied in a non-soccer pick'em? Yes
  for recording (NFL ties). For picking, no: only soccer offers tie picks. Recommendation: as
  written. Nothing to decide unless you want NFL tie picks, which no NFL pool offers.

## Slice 3: soccer and its knockout tournaments

The `add-sport` skill, as hockey did it.

- **Sport:** `SOCCER`, team participant, `HEAD_TO_HEAD`, `MATCHES`, `HALVES`, selection types
  `TIERED`, `BUDGET_PICK`, `RANDOM_DRAW`, `PICK_EM`, `BRACKET`, `SURVIVOR` and `SQUARES`,
  scoring `KNOCKOUT_ROUND_POINTS`, `shootout: { label: 'pens' }`,
  `pickEm: { tiePicks: true, againstTheSpread: false }`. Vocabulary: team/teams, event
  "tournament", match "match", round "round", eventStart "first kickoff", tie "Draw". Round
  names are counted back from the final: Final, Semi-finals, Quarter-finals, Round of 16,
  Round of 32; leagues override where they differ (the Champions League's "Knockout phase
  play-offs").
- **Leagues and test seeds** (last edition as played, each a knockout-stage event):
  - FIFA World Cup: 2022, round of 16 (the 2026 edition's round of 32 if its data is easier to
    get; it has just finished).
  - FIFA Women's World Cup: 2023, round of 16.
  - UEFA European Championship: 2024, round of 16.
  - Copa América: 2024, quarter-finals.
  - UEFA Champions League: 2025-26, from the knockout phase play-offs (24 teams, the top 8 on
    byes). Each two-legged tie is one match with the aggregate score, kicking off at the first
    leg. A level aggregate goes to the shoot-out columns.
- **Seeding:** tiers and budget prices come from seeds. Champions League seeds are league-phase
  places. The international tournaments have none, so the loader seeds by FIFA ranking at the
  start of the knockouts (see Q3.2).
- **Templates:** a named default per format per league, as #802 set out, with knockout round
  values sized to each league's rounds.

Questions:

- **Q3.1** Leave the third-place match out? The World Cups play one. The bracket model has no
  match a loser advances to (#793). Recommendation: leave it out. It isn't part of the bracket,
  isn't picked, and no pool we found scores it. **Decided 2026-10-21: left out.**
- **Q3.2** Seed international knockouts by FIFA ranking? The upset bonus and budget prices need
  a seed, and these tournaments seed nothing past the groups. Recommendation: yes, by FIFA
  ranking at the start of the knockouts. The alternative, group finishing position, gives 8
  teams seed 1. The upset bonus stays off by default anyway. **Decided 2026-10-21: FIFA ranking.**
- **Q3.3** Which optional leagues now? Recommendation: none beyond those above. The Gold Cup,
  Women's Euro, Women's Champions League, La Liga, Bundesliga, Serie A and WSL are each a league
  row plus a test data file, so they can be added as data whenever wanted. **Decided 2026-10-21: none now; the
  candidates are listed on #818 (deferred).**

## Slice 4: club and college playoffs

The same sport, three more league shapes:

- **MLS Cup playoffs** (2025): wild-card games, then a best-of-3 round one (one match per
  series, the score being games won; a drawn game in it goes straight to a shoot-out, so each
  game has a winner), then single games. 18 teams; the top seeds on byes past the wild card.
- **NWSL playoffs** (2025): 8 teams, single games.
- **NCAA Division I men's College Cup** (2025): 48 teams, the top 16 on byes.
- **NCAA Division I women's College Cup** (2025): 64 teams.

Each gets its own round names and tier count (`SportLeague.roundNames`, `tierCount`).

No open questions. Whether a league's bracket is fixed or reseeded is read from the source when
the seed file is written (`load-sport-data`).

## Slice 5: league seasons and group matchdays

A matchweek is a week of games, its own event, exactly like an NFL regular-season week (#715):
pick'em (straight or confidence, with draw picks) and survivor across a span of weeks.

- **Premier League** (2025-26 as played, 38 matchweeks): templates for pick'em, confidence
  pick'em and survivor ("Last Man Standing").
- **Group matchdays** of the World Cup, Euros and Copa América, and the Champions League league
  phase: each matchday is a week event of its tournament's league, for pick'em only. Test seed:
  the 2023 Women's World Cup group stage (three matchdays) beside its knockout seed.
- A postponed match is cancelled from its week, as an NFL game is (#767).

Questions:

- **Q5.1** Survivor uses each team once, and the Premier League has 20 teams, so a 38-week
  survivor runs out after 20 weeks. Last Man Standing games usually reset the used list once
  every team is used, or end the game by then. Recommendation: keep each team once for v1, and
  let commissioners pick a span of 20 weeks or fewer. Offer a reset as a follow-up if anyone asks.
- **Q5.2** Survivor on group matchdays? Recommendation: no. Three matchdays with a third of
  results drawn makes a poor survivor. Pick'em only, as decided. **Decided 2026-10-21:
  deferred.**
