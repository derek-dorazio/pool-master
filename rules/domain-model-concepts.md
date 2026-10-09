# PoolMaster — Domain Model Concepts

**What the domain is.** The entities, what each one means, what it is called on screen, what
it is easily confused with, and what the phrases people use in prompts mean in the model.

This file is vocabulary, not policy. How to *name and shape* things is
[domain-model-conventions-rules.md](domain-model-conventions-rules.md); who may call each
operation, with its error codes, is [`docs/DOMAIN-OPERATIONS.md`](../docs/DOMAIN-OPERATIONS.md);
scoring formats by sport are [`docs/CONTEST-RULES.md`](../docs/CONTEST-RULES.md). Fields are
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
League ─→ Contest ─→ SportEvent                                └─→ SportEventParticipant ─→ Participant
             │                                                       (the field)          (a golfer, or a team)
             └─→ ContestEntry ←── Squad
                    (entryNumber: a squad may hold several)
                    └─→ ContestEntryPick[] ─→ SportEventParticipant
```

Two readings of this chain have both been held at once, so it is worth stating plainly:

- **The Squad is a roster of people. The picks are a lineup of participants.** A squad owns
  contest entries; each entry holds its own `ContestEntryPick[]`. Nothing about golfers lives
  on the squad.
- **An entry belongs to the Squad, not to a user.** Every owner of the squad acts on its
  entries as their own (co-owners included).
- **A pick points at a `SportEventParticipant`, not a `Participant`.** It picks a golfer *in
  this event's field*, with that event's rank, tier and status.
- **A Contest belongs to one League and runs on one SportEvent.** Many contests, in many
  leagues, can run on the same event; they share its field, scores and tiers.

The tenant/global split is access rule A11 in `docs/DOMAIN-OPERATIONS.md`.

---

## 2. Vocabulary

"On screen" is the webapp's word where it differs from the model. The model word is the one
for code, contracts and prompts about code — `rules/poolmaster-webapp-rules.md` §1 *"Team" Is
A UI Label, Not A Domain Term*.

### People and leagues

| Model | On screen | What it is | Not to be confused with |
|---|---|---|---|
| `User` | account, owner | A person who can sign in. Global; belongs to no league | A league member — that is the `LeagueMembership` edge |
| `League` | league | A private office pool: a group of people who run contests together. Has a short `leagueCode` used in URLs | `SportLeague`, a real-world tour |
| `LeagueMembership` | member, commissioner | A user's place in one league, with `role` `COMMISSIONER` or `MEMBER`. **Commissioner is a role on this edge**, not a separate kind of user | Root admin, which is `User.isRootAdmin` and spans every league |
| `Squad` | team | A user's entrant vehicle in one league: a name, an icon and its owners. It enters contests | A sports team (a `Participant`), and "team" in plain English |
| `SquadMembership` | owner, co-owner | A user owning one squad. Every member of a squad is an owner; there is no primary owner | `LeagueMembership`, which carries the role |
| `LeagueInvitation` | invite, invite link | An email invite or a reusable link into a league | `SquadOwnerInvitation` |
| `SquadOwnerInvitation` | co-owner invite | An invite to become a co-owner of one squad, optionally replacing an owner | A league invite: it does not create a squad |

### The sport side

| Model | On screen | What it is | Not to be confused with |
|---|---|---|---|
| `Sport` | sport | Golf, and future sports. Says whether its participants are individuals or teams | `SportLeague` |
| `SportLeague` | tour | A real-world league or tour: PGA Tour, LPGA Tour, NBA | `League`, the office pool |
| `EventSeries` | (series) | A recurring named event, "The Masters", across all years | One year's edition, which is the `SportEvent` |
| `SportEvent` | tournament, event | One edition of a series in one `eventYear`, with a start date, round count and status | `Contest`, which is the pool's game played on it |
| `SportEventRound` | round | One scheduled round of an event (golf Round 1–4), with its own date | A participant's result in that round, `SportEventParticipantRound`; and a draft round (`ContestEntryPick.draftRound`) |
| `Participant` | golfer, player | A real competitor in a sport: a golfer, or a team such as an NBA team (`participantType` `INDIVIDUAL` or `TEAM`) | A league member (a person in the pool), and a `SportEventParticipant` |
| `SportEventParticipant` | the field, a golfer in the field | A participant entered in one event, with that event's rank, odds, seed and active/withdrawn/cut state | The global `Participant` |
| `SportEventTier`, `SportEventParticipantValuation` | tier, price | Tiers belong to the **event** and are shared by every contest on it; the valuation puts one field member in one tier, with a price | A contest-level setting: there is no per-contest tier override |
| `SportEventParticipantStanding` | position, leaderboard row | A field member's running position in the event (1 is best, every sport) | An entry's standing in a contest |

### Contests and entries

| Model | On screen | What it is | Not to be confused with |
|---|---|---|---|
| `Contest` | contest | One league's game on one event: format, selection type and scoring | The `SportEvent` it runs on |
| `ContestConfiguration` | contest settings | The contest's rules: roster size, picks per tier, entries per team, counting picks, prizes | `ContestConfigTemplate`, a global starting point it may be created from |
| `ContestEntry` | entry | One lineup a squad submits to one contest. A squad may hold several (`entryNumber`) | The squad itself |
| `ContestEntryPick` | pick, lineup | One field member chosen on one entry. The entry's picks are its lineup | A `SportEventParticipant`, which it points at |
| `ContestEntryStanding` | standings, final result | An entry's result, frozen when the contest settles | `SportEventParticipantStanding`, the golfer's position in the event |

### Words that mean more than one thing

- **Team**: the on-screen name for a `Squad`; a `Participant` whose `participantType` is
  `TEAM`; and the plain English word. In code and contracts, say `Squad`.
- **League**: the office pool is `League`; a real-world tour is `SportLeague`.
- **Draft**: three unrelated things. `DRAFT` is the first status of a `SportEvent`, a
  `Contest` and a `ContestEntry` (not yet released, opened, or submitted). The **draft room**
  is the screen where an entry's picks are made. `SNAKE_DRAFT` is an unbuilt selection
  mode; only `TIERED` exists.
- **Round**: an event's scheduled round (`SportEventRound`), one golfer's round
  (`SportEventParticipantRound`), and a snake-draft round (`draftRound`, unused).
- **Member**: a league member (`LeagueMembership`) or a squad member, which is the same as a
  squad owner (`SquadMembership`).
- **Player / golfer**: a `Participant`, never a league member.
- **Active**: `isActive` on a league, squad, user or field member (present in normal views),
  and the contest status `ACTIVE` (its event is in progress). Different things.

---

## 3. League Membership Is Team Ownership

A user is in a league **because** they own a team in it. The edges are one unit: every active
league membership has exactly one active squad membership in that league, and every way of
ending one ends both. The invariant and its enforcement are
[domain-model-conventions-rules.md](domain-model-conventions-rules.md) §12 *Membership and
squad membership are one unit*. What follows is what it means for the product.

- **There is no "remove from league" separate from the team.** Removing an owner from their
  team, removing a member from the league, and inactivating a team all end the same unit.
- **Remove Owner needs another owner.** A team with one active owner refuses it
  (`SQUAD_OWNER_REMOVE_REQUIRES_MULTIPLE_OWNERS`); the answer is to inactivate the team.
- **Inactivate Team is soft.** Commissioner or root admin only. It ends every owner's league
  membership, revokes the team's pending co-owner invitations, and keeps the team, its
  entries and its history. It is undone by inviting an owner back: accepting restores the
  original team with its history.
- **Delete Team is hard, and rare.** Root admin only, and only once the team is inactive. It
  removes the team with its entries, picks, memberships and invitations. It exists to clear
  QA residue, not to remove real teams; copy should not suggest otherwise.
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
| **release an event** | Root admin moves a `SportEvent` from `DRAFT` to `SCHEDULED`. Until then commissioners cannot see it. Needs a loaded field with every active golfer tiered; locks tiers and prices for good |
| **create a contest** | Commissioner creates a `Contest` on a released event that has not started. It is born `DRAFT`, seen only by commissioners, and its settings stay editable |
| **open a contest** | Commissioner moves it `DRAFT` → `OPEN`. Members can now see and enter it; its name and settings are locked with no undo |
| **enter a contest**, **create an entry** | A squad owner creates a `ContestEntry`, status `DRAFT`, numbered after the squad's highest entry in that contest |
| **draft**, **make picks**, **pick a golfer** | Add, swap or remove `ContestEntryPick`s on an entry in the draft room. Tiered selection only: the configuration says how many picks come from each event tier |
| **submit an entry** | `DRAFT` → `SUBMITTED`, refused unless the lineup is complete. Only submitted entries count on the leaderboard and in settlement. A later change that leaves the lineup short sends it back to `DRAFT`; a draft left at tee-off simply does not count |
| **lock a contest**, **entries close** | There is no lock action. Entries and picks change only while the contest is `OPEN` **and** its event's scheduled start (tee-off) has not passed — `areContestEntriesOpen`. Settings locked earlier, when the contest opened |
| **start**, **go live** | The event moves to `IN_PROGRESS` (by the lifecycle scheduler from the round schedule, or by an admin) and every `OPEN` contest on it becomes `ACTIVE`. **Picks are revealed** to the league from here; before it each team sees only its own |
| **score a round**, **scores come in** | A `SportEventParticipantRound` and its golf row are written, by the provider sync for a linked event or by an admin's correction, and the event standings are recomputed. Scoring stops at the event's scheduled round count; playoff holes are not a round |
| **unplayed round** | In contest scoring only, a round a golfer did not play (cut, withdrawn, disqualified, or the event ended) scores 80 strokes, counted against that round's par. The event's own standing keeps the golfer's real score |
| **correct a score** | Root admin enters the round's values directly; the server does not derive to-par |
| **sync**, **link an event** | Events are always created and owned by an admin. Linking one to a provider event (`syncScope` `SCORES_ONLY`) lets the provider send its live scores, and lets an admin load or refresh its field from the provider. A sync never creates an event or changes its details or status |
| **seed / load / refresh the field** | Seed adds golfers from the tour's affiliations. Load/refresh queues a provider field sync that adds golfers and replaces the ranking, odds, seed and withdrawal of every golfer the provider reports, admin-set values included. All act on `SportEventParticipant` rows |
| **settle** | When the event completes, each contest's submitted entries get a frozen `ContestEntryStanding` and the contest becomes `COMPLETED`. A later score correction does not change a settled result. Entries can tie |
| **inactivate / delete a team** | §3 above |

### Not in the model

- **Money changes hands outside PoolMaster.** Prize definitions describe the payout; nothing
  pays it.
- **A contest cannot be cancelled, and an entry cannot be made inactive.** A contest is
  `DRAFT`, `OPEN`, `ACTIVE` or `COMPLETED`; an entry is `DRAFT` or `SUBMITTED`.
- **A league has no join policy.** Every join is through an invitation.
