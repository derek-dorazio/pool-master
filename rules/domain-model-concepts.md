# PoolMaster — Domain Model Concepts

**What the domain is.** The entities, what each one means, what it is called on screen, what
it is easily confused with, and what the phrases people use in prompts mean in the model.

This file is vocabulary, not policy. How to *name and shape* things is
[domain-model-conventions-rules.md](domain-model-conventions-rules.md); who may call each
operation, with its error codes, is [`docs/DOMAIN-OPERATIONS.md`](../docs/DOMAIN-OPERATIONS.md).
Fields are
`schema.prisma` and `packages/shared/domain`; nothing here lists them.

---

## 1. The Entity Chain

The model has two halves that meet at exactly one point, the pick.

```
Pool side (one League's data)                Sport side (global, shared by every league)

User                                         Sport                (golf)
 ├─→ LeagueMembership ─→ League               └─→ SportLeague      (a tour: PGA Tour)
 │     (role: COMMISSIONER | MEMBER)                └─→ EventSeries (The Masters, every year)
 └─→ SquadMembership ─→ Squad                            └─→ SportEvent (the 2026 Masters)
       (an owner; one per user per league)                     ├─→ SportEventRound   (Round 1..4)
                          │                                    ├─→ SportEventTier    (Tier A..)
League ─→ Contest ─→ ContestSportEvent[] ─→ SportEvent        └─→ SportEventParticipant ─→ Participant
             │        (sequence: 1, 2, ...)                          (the field)          (a golfer, or a team)
             └─→ ContestEntry ←── Squad
                    (entryNumber: a squad may hold several)
                    ├─→ ContestEntryEvent[]  (DRAFT | SUBMITTED, one per contest event)
                    ├─→ ContestEntryPick[] ─→ SportEventParticipant          (ROSTER contests)
                    └─→ ContestEntryMatchPrediction[] ─→ SportEventMatch     (PREDICTION contests)
                          (the team picked to win: a SportEventParticipant)
```

Two readings of this chain have both been held at once, so it is worth stating plainly:

- **The Squad is a roster of people. The picks are a lineup of participants.** A squad owns
  contest entries; each entry holds its own `ContestEntryPick[]`. Nothing about golfers lives
  on the squad.
- **An entry belongs to the Squad, not to a user.** Every owner of the squad acts on its
  entries as their own (co-owners included).
- **A pick points at a `SportEventParticipant`, not a `Participant`.** It picks a golfer *in
  this event's field* (a golfer, a horse, a team), with that event's rank, tier and status.
- **A Contest belongs to one League and covers one or more SportEvents** (`ContestSportEvent`,
  in `sequence` order, #713). A tournament pool covers one event; a golf majors pool covers each
  major of a year, and an NFL pick'em one event per week. Every event of a contest comes from the same sport league. Many contests, in many
  leagues, can run on the same event; they share its field, scores and tiers.
- **Draft and submitted are per entry per event** (`ContestEntryEvent`). An entry submits each
  event's picks on its own; a pick belongs to an event through the field row it points at.
- **A contest's format says what an entry picks** (#716). A `ROSTER` contest's entries pick a
  lineup of field members (`ContestEntryPick`); a `PREDICTION` contest's entries pick the winner
  of each game of an event (`ContestEntryMatchPrediction`), naming the team, never "home" or
  "away". A `SQUARES` contest's entries claim boxes of a grid on one game (#711). The selection
  type decides the format: `PICK_EM`, `BRACKET` and `SURVIVOR` are `PREDICTION`, `SQUARES` is
  `SQUARES`, every other type `ROSTER`.
- **A bracket is one knockout picked to its final** (`BRACKET`, #721). Its contest covers one
  event, and every pick is made before the event starts. A **second-chance bracket** starts at a
  later round (`startsAtRound`, the Sweet 16): it is picked from that round on, and its picks close,
  are revealed and the contest goes live at that round's first game, while the event is under way. A later game's pick is a team the entry
  picked to get there (in a reseeded round, its picked winners paired by seed), so changing a pick
  clears the later picks that followed from it. A correct pick scores its round's value under the
  knockout round points, as a knockout roster pool does.
- **A knockout roster pick scores per match it wins** (`KNOCKOUT_ROUND_POINTS`, #699): that
  round's value from the contest's table, plus an upset bonus when the contest has one on. A
  team placed straight into a later round (a bye) scores nothing for the round it skipped.
- **A match's winner is its own fact** (`winnerSide`), and every scorer reads it, never the
  score. In a sport that settles a level knockout by shoot-out (`SportDefinition.shootout`,
  soccer's penalties), a bracket match level after extra time names its winner by the
  shoot-out's scores (`homeShootoutScore`, `awayShootoutScore`, #791), kept apart from the match
  score as IFAB Law 10 has it: screens show "1-1 (4-3 pens)", and the tiebreaker and squares read
  the 1-1.
- **A match can end early, in any sport that plays matches** (`ending`, a `MatchEnding`, #704):
  `PLAYED` unless the loser retired part way (`RETIREMENT`), never started (`WALKOVER`) or was
  disqualified (`DEFAULT`). The winner wins in full, since scorers read only `winnerSide`: it
  advances, earns the round's value and any upset bonus, and keeps a survivor pick alive; the
  other side is out. After a retirement or default the winner's score may be the lower (where it
  stopped); a walkover has no score. Screens mark the result "ret.", "w/o" or "def.".
- **A random draw deals the picks** (`RANDOM_DRAW`, #601). The commissioner's **Run draw** deals
  every entry the same number of field members, round-robin from a seeded shuffle recorded for
  replay; leftovers go undealt. The draw submits every entry, closes entries and reveals every
  pick at once. It is final: no undo, no redraw, and a dealt golfer who withdraws scores by the
  sport's normal rules.
- **A prediction event's tiebreaker is per event** (#717), on `ContestEntryEvent`: one guess of
  its tiebreaker game's total points, a bracket's final or a pick'em week's last game by kickoff.
  Every week needs one to submit. A roster contest's tiebreaker stays on the `ContestEntry`.
- **A pick'em pick scores by the pool's mode** (#717), not by a scoring definition: 1 point
  straight up, its confidence value in a confidence pool, nothing for a loss or a tie.
- **A pick'em pick can be a tie** (#792) where the sport says its games can end level
  (`pickEm.tiePicks` on the sport definition): `predictedResult` `TIE` with no team, against
  `TEAM` with one. It is correct when the game ends level, and scores as a correct team pick
  does. The screen calls it by the sport's word (`vocabulary.tie`: "Draw" in soccer, "Tie"
  elsewhere); the code term is always TIE. Only pick'em offers it: a survivor or bracket pick is
  always a team, and a survivor pick on a game that ends level is out. Only a game of a week can
  end level; a bracket match always has a winner.
- **A pool against the spread scores the team that covers** (`againstTheSpread`, #720), in
  either mode. Each game carries its spread from the home side (`homeSpread`, "Chiefs -3.5"); a
  team covers when its score plus its spread beats the other team's. A game landing exactly on
  the spread is a **push**, worth nothing to either side.
- **A survivor entry plays until it loses** (`SURVIVOR`, #719): one pick a week, each team once
  a season (by participant, not field row), out after a loss, a tie or a week not submitted by
  its first kickoff, and out for good. A pick on a cancelled game survives, and since it locks only at
  its game's kickoff, it can still be swapped to a later game that week. On a playoff bracket (#785)
  each round is a week: the event is submitted once with its first round's pick, each later
  round takes one pick before its first game or the entry is out, and running out of unused teams
  means out. Its score is the weeks (rounds) it survived; it has no tiebreaker.
- **An entry that misses an event of a multi-event contest still scores it** (#714): as if each
  counted pick were unplayed (golf: 80 a round), so missing a major costs, never helps.
- **A week of games is not a knockout** (#768). An event whose matches form no bracket (an NFL
  regular-season week) ranks no team and crowns no champion: each team's standing is neutral,
  complete once its game is played or cancelled.
- **A squares contest is a 10x10 grid on one game** (`SQUARES`, #711): entries claim boxes up to
  the contest's limit, then the commissioner draws the digits 0 to 9 along each side (away team's
  rows, home team's columns). Each quarter's end and the final score, overtime included, wins the
  box matching both scores' last digits; an unclaimed box means no winner. It closes at its
  game's kickoff, not its event's start, and settles with its game, not its event. Its score is
  the quarters won, ties shared; it has no picks and no tiebreaker.

The tenant/global split is access rule A11 in `docs/DOMAIN-OPERATIONS.md`.

---

## 2. Vocabulary

"On screen" is the webapp's word where it differs from the model. The model word is the one
for code, contracts and prompts about code — `rules/poolmaster-webapp-rules.md` §1 *A Squad Is
Shown By Its Name*.

### People and leagues

| Model | On screen | What it is | Not to be confused with |
|---|---|---|---|
| `User` | account, owner | A person who can sign in. Global; belongs to no league | A league member — that is the `LeagueMembership` edge |
| `League` | league | A private office pool: a group of people who run contests together. Has a short `leagueCode` used in URLs | `SportLeague`, a real-world tour |
| `LeagueMembership` | member, commissioner | A user's place in one league, with `role` `COMMISSIONER` or `MEMBER`. **Commissioner is a role on this edge**, not a separate kind of user | Root admin, which is `User.isRootAdmin` and spans every league |
| `Squad` | its name | A user's entrant vehicle in one league: a name, an icon and its owners. It enters contests | A sports team (a `Participant`), and "team" in plain English |
| `SquadMembership` | owner, co-owner | A user owning one squad. Every member of a squad is an owner; there is no primary owner | `LeagueMembership`, which carries the role |
| `LeagueInvitation` | invite, invite link | An email invite or a reusable link into a league | `SquadOwnerInvitation` |
| `SquadOwnerInvitation` | co-owner invite | An invite to become a co-owner of one squad, optionally replacing an owner | A league invite: it does not create a squad |

### The sport side

| Model | On screen | What it is | Not to be confused with |
|---|---|---|---|
| `Sport` | sport | Golf, horse racing, auto racing, cycling, running, basketball, American football, hockey, baseball, soccer and tennis, and future sports. Says whether its participants are individuals or teams. Each sport's on-screen words (golfer or horse, tournament or race, "Cut", "Scratched") are its sport definition's vocabulary | `SportLeague` |
| `SportLeague` | tour | A real-world league or tour: PGA Tour, LPGA Tour, NBA. A bracket league may name its own rounds (`roundNames`: the NBA's Conference Finals), shown in place of the sport's, and start its events on its own tier count (`tierCount`: the College Football Playoff's six) | `League`, the office pool |
| `EventSeries` | (series) | A recurring named event, "The Masters", across all years | One year's edition, which is the `SportEvent` |
| `SportEvent` | tournament, event | One edition of a series in one `eventYear`, with a start date, round count and status | `Contest`, which is the pool's game played on it |
| `SportEventRound` | round | One scheduled round of an event (golf Round 1–4), with its own date | A participant's result in that round, `SportEventParticipantRound`; and a pick's `lineupSlot`, its position in the entry's lineup |
| `Participant` | golfer, horse, team (the sport's word) | A real competitor in a sport: a golfer, or a team such as an NBA team (`participantType` `INDIVIDUAL` or `TEAM`) | A league member (a person in the pool), and a `SportEventParticipant` |
| `SportEventParticipant` | the field, a field member | A participant entered in one event, with that event's rank, odds, seed and active/withdrawn/cut state | The global `Participant` |
| `SportEventTier`, `SportEventParticipantValuation` | tier, price | Tiers belong to the **event** and are shared by every contest on it; the valuation puts one field member in one tier, with a price | A contest-level setting: there is no per-contest tier override |
| `SportEventParticipantStanding` | position, leaderboard row | A field member's running position in the event (1 is best, every sport) | An entry's standing in a contest |
| `SportEventMatch` | match, game, bracket | One game of an event played as matches (#698): a knockout bracket's, or an NFL week's: its round, its home and away field members (either empty until an earlier match's winner fills it), a neutral-site flag, a time, a status, the winning side and both scores, the match and side its winner advances to, and its region or conference. A playoff series is one match whose score is games won. Only a sport whose tournament format is `MATCHES` has them; whether they form a bracket is read from their links (#715) | A `Contest`, and a `SportEventRound`, the round it is played in |
| `SportEventMatchPeriodScore` | quarter score | Both sides' score at the end of one period of a game but the last (#772): the end of a quarter in American football or a period in hockey, as the scoreboard shows it, earlier periods included. Only a sport whose definition names a `matchPeriodLayout` keeps them, in its sport league's own layout when it has one (`SportLeague.matchPeriodLayout`, #786: men's college basketball plays two halves; read through `matchPeriodsOf`). The final score, overtime included, is the match's own `homeScore`/`awayScore`, never a period row. Squares pools read them | The points scored in that period alone, which nothing stores |
| `SportEventParticipantRaceResult` | finish, result | How one runner's race ended (finish position): its place, or did not finish, disqualified, did not start; whether the race's result is official; its rider and post position. The admin enters it | `SportEventParticipantStanding`, its place in the event, which the finishing order writes beside it |

### Contests and entries

| Model | On screen | What it is | Not to be confused with |
|---|---|---|---|
| `Contest` | contest | One league's game on one or more events: format, selection type and scoring | The `SportEvent`s it covers (`ContestSportEvent`) |
| `ContestSportEvent` | event (of a contest) | One event a contest covers, with its place in the contest's order | The `SportEvent` itself |
| `ContestConfiguration` | contest settings | The contest's rules: roster size, picks per tier, entries per member, counting picks, prizes, and its scoring (a scoring definition and its settings, such as a racing points table) | `ContestConfigTemplate`, a global starting point it may be created from: sport-wide, or one sport league's own preset (`sportLeagueId`) |
| `ContestEntry` | entry | One lineup a squad submits to one contest. A squad may hold several (`entryNumber`) | The squad itself |
| `ContestEntryEvent` | entry status (submitted, not submitted) | An entry's draft/submitted status for one event of its contest | The entry itself |
| `ContestEntryPick` | pick, lineup | One field member chosen on one entry. The entry's picks for an event are its lineup for that event | A `SportEventParticipant`, which it points at |
| `ContestEntryMatchPrediction` | game pick, pick | A prediction contest entry's pick of one game's winner, with a confidence value in a confidence pool | A `ContestEntryPick`, a roster contest's lineup pick |
| `ContestSquaresGame`, `ContestEntrySquare`, `ContestSquaresDraw`, `ContestSquaresWinner` | squares game, box, numbers, winner | A squares contest's one game (#711); one claimed box of its grid, held by an entry; its drawn digits (`rowDigits` the away team's, `columnDigits` the home team's, with the seed); and, frozen at settlement, each scoring moment's winning box and entry, or none | A pick (`ContestEntryPick`, `ContestEntryMatchPrediction`): a box picks no team |
| `ContestEntryEventStanding` | event result | An entry's result in one event, frozen when that event settles | `ContestEntryStanding`, the contest total |
| `ContestEntryStanding` | standings, final result | An entry's contest total (the sum of its event results), frozen when the contest settles | `SportEventParticipantStanding`, a field member's position in the event |

### Words that mean more than one thing

- **Team**: on screen, a `Participant` whose `participantType` is `TEAM` (the sport
  vocabulary's word); a `Squad` is shown by its name instead. In code and contracts, the
  user's group is a `Squad`.
- **League**: the office pool is `League`; a real-world tour is `SportLeague`.
- **Selection, pick, draft** (#544): **selection** is the process and its configuration
  (`SelectionType`, `SelectionStatus`, the `selections` module and `/api/v1/selections`
  routes); the **selection room** is the screen where an entry's picks are made. A **pick** is
  one participant chosen, the `ContestEntryPick` record. **Draft** is not a process name: it
  survives only as the snake draft selection type (unbuilt and not in the enum since #605;
  `TIERED`, `BUDGET_PICK` and `RANDOM_DRAW` are the built types), and as `DRAFT`, the first status of a `SportEvent`, a `Contest` and a
  `ContestEntry` (not yet released, opened, or submitted).
- **Round**: an event's scheduled round (`SportEventRound`) and one golfer's round
  (`SportEventParticipantRound`). A pick's `lineupSlot` is its position in the lineup, not a round.
- **Member**: a league member (`LeagueMembership`) or a squad member, which is the same as a
  squad owner (`SquadMembership`).
- **Player / golfer**: a `Participant`, never a league member.
- **Horse, runner**: a horse racing `Participant`, and on a race's field a `SportEventParticipant`.
  The jockey is the result's `riderName`, not a participant.
- **Driver**: an auto racing `Participant`, one per person whichever series they race in. An
  auto racing result names only the driver, so its `riderName` stays empty.
- **Series**: what auto racing calls a `SportLeague` (NASCAR Cup Series, IndyCar, Formula 1),
  and running too (World Marathon Majors (men), World Marathon Majors (women)). Not
  `EventSeries`, the recurring named event.
- **Rider (cycling)**: a cycling `Participant`. Not the result's `riderName`, which is horse
  racing's jockey: a cycling result names only the rider, so its `riderName` stays empty. A rider
  who abandons mid-race is a `DID_NOT_FINISH` result, not a withdrawal.
- **Tour (cycling)**: what cycling calls a `SportLeague` (UCI WorldTour, UCI Women's WorldTour).
  A Grand Tour (the Tour de France) is one `SportEvent` with one round; its result is the final
  overall classification, and its stages are not rounds.
- **Runner (running)**: a running `Participant`, one of a marathon's elite field. Horse racing
  also says "runner" for a horse in a race; the word is the sport's vocabulary, not a model. A
  running result names only the runner, so its `riderName` stays empty, and a runner who drops
  out is a `DID_NOT_FINISH` result, not a withdrawal. A marathon is one `SportEvent` with one
  round.
- **Scratched, withdrawn**: a runner taken out of a race before the start is a field member made
  inactive with `inactiveReason` `WITHDRAWN`; horse racing shows it as "Scratched". A runner
  that did not start is a result (`DID_NOT_START`), which also leaves it `WITHDRAWN` in the standing.
- **Withdrawn after the draw, replacement** (#704): in any bracket sport, a field member who
  withdraws before their first-round match is made inactive (`WITHDRAWN`) and a replacement (a
  tennis lucky loser) gets a field row of its own in that bracket place; a bye's place is not
  replaced. "Withdrawn" in scoring means `WITHDRAWN` and named by no match. Picks stay on the withdrawn row
  and score as a first-round loss; they never move to the replacement, unlike a play-in place,
  which stands for whoever wins it. After the match starts a withdrawal is a walkover result.
- **Official**: a race's result counts for contest scoring only once the admin marks it official,
  which applies to the whole race. Until then its places are provisional.
- **Dead heat**: runners who share a finishing place. Both take that place's full points, and the
  next place is skipped (1, 2, 2, 4).
- **Bracket, seed, play-in (basketball)**: the bracket is the event's matches. A **seed** is the
  field member's `seedNumber`, locked once a bracket event is released. A First Four
  **play-in** place is one field member standing for the pairing ("Texas / Xavier"), marked
  `isPlayInPlace` before release; only a marked row takes a winner, and its winner
  takes over that field row, ending the mark, keeping its seed, tier, price and picks, and the pairing's
  participant is inactivated. A side with no team is filled by an earlier match's winner; a team with a **bye** is named
  straight on a later round's match, with no earlier match feeding its side. A sport league whose
  `bracketAdvancement` is `RESEED_BY_SEED` **reseeds**: a round's winners go to no fixed match, and
  the admin places them by seed within their region (the NFL's Divisional round). The rule holds
  while any of the league's events has a bracket loaded, since the bracket's links were drawn for it.
- **Active**: `isActive` on a league, squad, user or field member (present in normal views),
  and the contest status `ACTIVE` (its first event has started and it has not settled). Different things.

---

## 3. League Membership Is Squad Ownership

On screen a squad is shown by its name, never as "team" or "squad"
(`rules/poolmaster-webapp-rules.md` §1 *A Squad Is Shown By Its Name*); this section says
"squad" because it describes the model.

A user is in a league **because** they own a squad in it. The edges are one unit: every active
league membership has exactly one active squad membership in that league, and every way of
ending one ends both. The invariant and its enforcement are
[domain-model-conventions-rules.md](domain-model-conventions-rules.md) §12 *Membership and
squad membership are one unit*. What follows is what it means for the product.

- **There is no "remove from league" separate from the squad.** Removing an owner from their
  squad, removing a member from the league, and inactivating a squad all end the same unit.
- **A squad left with no owner is inactive, and its pending co-owner invitations are revoked.**
  However it happens (inactivating the squad, or removing its last owner from the league), the
  invitations close with it, so none can revive the squad and none keeps its address from
  being invited to another squad. Replacing a sole owner is a hand-over, not an ending: the
  squad stays active and its invitations stay pending.
- **Remove Owner needs another owner.** A squad with one active owner refuses it
  (`SQUAD_OWNER_REMOVE_REQUIRES_MULTIPLE_OWNERS`); the answer is to inactivate the squad.
- **Inactivating a squad is soft.** Commissioner or root admin only. It ends every owner's league
  membership, revokes the squad's pending co-owner invitations, and keeps the squad, its
  entries and its history. It is undone by inviting an owner back: accepting restores the
  original squad with its history.
- **Deleting a squad is hard, and rare.** Root admin only, and only once the squad is inactive. It
  removes the squad with its entries, picks, memberships and invitations. It exists to clear
  QA residue, not to remove real members' squads; copy should not suggest otherwise.
- **Nothing here touches the user's account.** Ending a membership never inactivates,
  deletes or signs out the user; they can still sign in and accept another invitation.
  Account actions are the user's own or a root admin's —
  `rules/poolmaster-webapp-rules.md` §2 *Role Scopes*.

---

## 4. The Verbs

What the phrases people use mean in the model. Status names are the enum values; the
operations and their codes are in `docs/DOMAIN-OPERATIONS.md`.

| Phrase | What happens in the model |
|---|---|
| **create a league** | Writes the `League`, a `COMMISSIONER` `LeagueMembership` for the creator, and the creator's first `Squad`, in one request. The commissioner membership is the only record of who runs the league |
| **join a league** | Accept a `LeagueInvitation` (email or link). Creates the `LeagueMembership` and the user's `Squad` with them as owner, or restores the squad they had before |
| **invite a co-owner** | A `SquadOwnerInvitation` to one active squad, sent to one email address. An existing account is added as an owner (and league member) straight away; a new address joins on sign-up. Refused to someone already in the league |
| **release an event** | Root admin moves a `SportEvent` from `DRAFT` to `SCHEDULED`. Until then commissioners cannot see it. Needs a loaded field with every active field member tiered and priced (#93); locks tiers, prices and the event's pricing values for good |
| **create a contest** | Commissioner creates a `Contest` on one or more released events that have not started, all from one sport league. It is born `DRAFT`, seen only by commissioners, and its settings stay editable |
| **add events**, **change a contest's events** | Commissioner sets the contest's events from its sport league (any year; "add all" takes a season). Added events must be released and not started; the contest keeps them in start order. Allowed until the contest is `COMPLETED`; removing one is refused once any of its events has started, and deletes the picks made for it. A random draw covers one event |
| **open a contest** | Commissioner moves it `DRAFT` → `OPEN`. Members can now see and enter it; its name and settings are locked with no undo |
| **enter a contest**, **create an entry** | A squad owner creates a `ContestEntry`, `DRAFT` for every event of the contest, numbered after the squad's highest entry in that contest. Only while the contest is `OPEN` and its first event has not started: nobody joins a contest already being played |
| **make picks**, **pick a golfer** (or horse, driver, team) | Add, swap or remove `ContestEntryPick`s on an entry in the selection room. Tiered: the configuration says how many picks come from each event tier; budget pick: the roster size caps the picks; random draw: none, the draw deals them |
| **pick a game**, **make game picks** | In a pick'em contest, save the team an entry says wins each game of an event (`ContestEntryMatchPrediction`), and in a confidence pool a value from 1 to the event's number of games. Each pick saves on its own while the week is a draft; a value may repeat until submit. Each game's pick locks at that game's kickoff and is revealed to the league then (`areMatchPicksOpen`, `areMatchPicksRevealed`). After the event's first kickoff a submitted week stays submitted: a pick on a game still to start can be swapped to the other team, but not cleared |
| **submit an entry** | Submits one event's picks: that event's `ContestEntryEvent` goes `DRAFT` → `SUBMITTED`, refused unless the lineup is complete. Only submitted events count on the leaderboard and in settlement. A later change that leaves the lineup short sends that event back to `DRAFT`; an event left unsubmitted at its start simply scores nothing. In a pick'em contest the week is submitted once every game is picked (with confidence values 1 to the game count, each once), and a week still in draft at its first kickoff can no longer be picked or submitted |
| **lock a contest**, **entries close** | There is no lock action. Entries are created, renamed or left only while the contest is `OPEN` and its first event has not started (`areContestEntriesOpen`). An event's picks change while the contest is `OPEN` or `ACTIVE` and that event's scheduled start has not passed (`areEventPicksOpen`). Settings locked earlier, when the contest opened |
| **start**, **go live** | The contest's first event moves to `IN_PROGRESS` (by the lifecycle scheduler from the round schedule, or by an admin) and the `OPEN` contest becomes `ACTIVE`. **Picks are revealed** event by event: an event's picks are visible to the league once that event starts; before it each entry's owners see only their own |
| **score a round**, **scores come in** | A `SportEventParticipantRound` and its golf row are written, by the provider sync for a linked event or by an admin's correction, and the event standings are recomputed. Scoring stops at the event's scheduled round count; playoff holes are not a round |
| **unplayed round** | In contest scoring only, a round a golfer did not play (cut, withdrawn, disqualified, or the event ended) scores 80 strokes, counted against that round's par. The event's own standing keeps the golfer's real score |
| **correct a score** | Root admin enters the round's values directly; the server does not derive to-par |
| **sync**, **link an event** | Events are always created and owned by an admin. Linking one to a provider event (`syncScope` `SCORES_ONLY`) lets the provider send its live scores, and lets an admin load or refresh its field from the provider. A sync never creates an event or changes its details or status |
| **load sport data** | The "Load sport data" workflow applies a sport data file: a season's schedule, then each event's field. Every sport league loads this way; only the source sites differ (`docs/SPORT-DATA-SOURCES.md`) |
| **cancel an event**, **cancel a game** | Admin moves a `SportEvent` to `CANCELLED`, or cancels one `SportEventMatch` (a postponed NFL game). A cancelled event counts for nothing (*Not in the model* below); a cancelled game is dropped from its week |
| **seed / load / refresh the field** | Seed adds golfers from the tour's affiliations. Load/refresh queues a provider field sync that adds golfers and replaces the ranking, odds, seed and withdrawal of every golfer the provider reports, admin-set values included. All act on `SportEventParticipant` rows |
| **settle** | When an event completes, each contest on it freezes a `ContestEntryEventStanding` for every entry that submitted it. When the contest's last event has completed, each entry's total (the sum of its event results) is frozen as its `ContestEntryStanding` and the contest becomes `COMPLETED`. A later score correction does not change a settled result. Entries can tie. In a pick'em contest each week's settled place 1 is that **week's winner** (#717) |
| **inactivate / delete a squad** | §3 above |

### Not in the model

- **Money changes hands outside PoolMaster.** Prize definitions describe the payout; nothing
  pays it.
- **A contest cannot be cancelled, and an entry cannot be made inactive.** A contest is
  `DRAFT`, `OPEN`, `ACTIVE` or `COMPLETED`; an entry is `DRAFT` or `SUBMITTED`.
- **A cancelled event counts for nothing.** It is settled with no result for anyone, adds
  nothing to any total, and never holds its contest open: a contest settles once each of its
  events is completed or cancelled. A contest whose events are all cancelled ends `COMPLETED`
  with no scores.
- **A league has no join policy.** Every join is through an invitation.
