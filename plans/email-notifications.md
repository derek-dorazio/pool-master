# Email notifications

**Tracking issue:** #845

Written 2026-10-21 for Derek's ask: list every email Poolmaster should send, organised by the
lifecycle it follows (accounts, leagues, events, contests, live play, settlement), with who
gets it, what fires it and what it says. This is the functional catalog only. Two other
designs sit beside it and are referenced, not repeated:

- **Sending real email** (#844, `plans/email-delivery-ses.md`): AWS SES delivery, templates and
  their copy in code, merging, the outbox, preferences and unsubscribe, bounces. This catalog says
  *what* each email carries, *who* gets it and *when*; that design says *how*. Its *Who owns what*
  table splits the two, and its §10 orders both plans' slices together.
- **Password recovery**: there is none today (no forgot-password route or screen), so its
  emails are listed here and designed there.

Questions sit under the section they belong to, each with a recommendation. None blocks
writing the first slice's tickets.

---

## TL;DR

- **Four emails exist today**: league invite (also used by Resend Invite), welcome on joining
  a league, entry submitted, and the contest-live summary. All are sent inline, one by one,
  inside the request or scheduler sweep that caused them, with no record that they were sent.
- **About thirty more are worth having**, below in seven tables. The ones Derek named are the
  core: contest open, entry reminders, contest live with "good luck" and the entries, standings
  after each round or week with the top 10, final results with the winners, and the
  commissioner "event coming soon" and "event ready" pair.
- **Two kinds of email.** *Account and action emails* (invites, password reset, a receipt for
  something the person just did) always send. *League updates* (contest open, reminders,
  standings, results, commissioner nudges) can be switched off by category and carry a one-click
  unsubscribe, which bulk-mail rules at Gmail and Yahoo require.
- **Time-based emails need two new pieces**: a sent-email record, so a scheduler sweep never
  sends the same email twice, and the existing lifecycle scheduler asking "is anything due?"
  on each sweep. Both belong to the first slice.
- **Six slices**, ordered by value: foundation, contest lifecycle, live standings, final
  results, commissioner event emails, then the league and account gaps.

---

## 1. What exists today

| Template key | Fires when | Sent to | Notes |
|---|---|---|---|
| `LEAGUE_MEMBER_INVITE` | A commissioner invites by email, and again on Resend Invite | The invited address | Inviter, league, league code, optional message, expiry, Join league button |
| `LEAGUE_JOIN_SUCCESS` | An invitation is accepted | The person who joined | League, their squad's name, the league's open contests (#903), League Home button |
| `CONTEST_ENTRY_COMPLETED` | An entry's lineup is submitted for an event in the selection room | The person who submitted (not co-owners) | Lineup by tier and the tiebreaker. Roster contests only: pick'em and survivor submits send nothing, and the tiebreaker is always formatted as golf to-par (since #867: every owner, every entry type, see D3) |
| `CONTEST_STARTED_SUMMARY` | An `OPEN` contest becomes `ACTIVE` at its cutoff | Active commissioners plus owners of squads with a submitted entry, each once | Event, start time, entry count and **every** entry (no cap), contest link. No "good luck", no leaderboard link, and members with no entry are not told |

Each template can be switched off on the root admin Settings page (`EMAIL_CONFIG`). QA sends
nothing until real delivery is wired. Co-owner invitations (`SquadOwnerInvitation`) send B4 or B5
since slice 6.

---

## 2. Rules every notification follows

These hold for every row below, so the tables don't repeat them.

1. **Each league sends its own.** Leagues are tenants (Derek 2026-10-21): no email combines
   two leagues, and each carries only its own league's links. Within one league, a person who
   owns two squads with entries, or is both commissioner and member, gets one email per
   trigger. A commissioner of two leagues gets C1 once from each. Recipients are active users with an active league
   membership; an inactive squad's owners are not league members and get nothing.
2. **Never twice.** Every send writes a record keyed by template, subject (contest, event,
   round or invitation) and recipient: the SES design's outbox row and its idempotency key. A scheduler sweep that runs again, or a second server
   task, finds the record and skips. A resend the person asked for (Resend Invite, a new reset
   link) is a new subject, so it still sends.
3. **Squads by name.** Entries and standings show the squad's name and the entry name, never
   "team" or "squad" (`rules/poolmaster-webapp-rules.md` §1 *A Squad Is Shown By Its Name*). A
   real team is called by the sport's word.
4. **The sport's words.** Tournament, race, week, round, golfer, horse, driver, team: from the
   sport definition's vocabulary, the same words the screens use.
5. **Product copy only.** No ids, no developer notes, no status enum names in the body.
6. **Every email links back.** One primary button (the leaderboard, the selection room, the
   contest) plus a footer link to email settings. League updates also carry one-click
   unsubscribe for their category.
7. **Times in the reader's time zone.** `User.timezone` exists; when it is empty, the event's
   own local time with its zone name.
8. **Cancelled things say so plainly.** A cancelled event or game counts for nothing; emails
   that would have reported on it say it was cancelled instead of going quiet.

### Categories (for opt-out)

| Category | Who can turn it off | Rows |
|---|---|---|
| Account and security | Nobody | A1–A5 |
| Invitations and membership | Nobody (they are the action itself) | B1–B5 |
| Commissioner updates | The commissioner, per category | B6–B8, C1–C7, F4 |
| Contest updates | Each member, per category | D1–D2, D5–D7, F2 |
| Live standings | Each member | E1–E8 |
| Results | Each member | F1, F3 |
| Receipts | Each member | D3, D4 |
| Root admin | Nobody | G1, G2 |

**Q2.1 Opt-out granularity.** **Decided (Derek 2026-10-21):** one on/off switch per category
per person, applying to all their leagues, plus one-click unsubscribe. It is the same decision
as Q7.1 in the SES design (#844), which builds the switches; this plan supplies the categories.

**Q2.2 Digest instead of separate emails.** **Decided (Derek 2026-10-21):** no digests for
members. Each contest sends its own email, and nothing combines leagues (§2 rule 1). The
weekly digest in #851 is for commissioners and covers one league.

---

## 3. The catalog

Columns: **Trigger and conditions** is the model change or clock time that fires it; **Timing**
is when it goes relative to that; **Today** is ✅ exists, 🟡 partly, or blank for new.
**Priority** is P1 (Derek's list and the gaps that block it), P2 (clearly worth it), P3 (later).
**Class** is the service level the email belongs to (Derek 2026-10-22, a first guess for him
to review), so monetization can later send an email only to leagues whose plan includes it.
Classes are not plan names, and email needs only three (Derek: don't force four levels where
they don't fit). **Essential**: account, security and membership email, every league always.
**A**: the basics, free plan too (a contest opening, receipts, final results, an event cancelled
or moved). **B**: paid conveniences (reminders, commissioner nudges, the good luck and "you're
out" emails, standings while an event is live, a commissioner's "remind everyone" button if
built). Emails about sports league cups, the league championship, season standings and
trophies are **B** too, matching those features' class in `plans/season-cups.md` §7 (Derek
2026-10-22); their rows come with #841, #863 and #837. Since #944 the letters are retired: each
`EMAIL_TEMPLATES` entry names its own `planFeature` (null for Essential), and the plan it starts
at is a root admin setting in `PLAN_CONFIG`, starting A at Free and B at Pro. The columns below
keep the letters as a record of where each email started.

### A. Accounts

| # | Name | Trigger and conditions | Audience | Timing | Key content and links | Today | Priority | Class |
|---|---|---|---|---|---|---|---|---|
| A1 | Reset your password | Someone asks for a reset on the sign-in screen with an address that has an active account | That account's email | At once | Reset link with a short expiry, "didn't ask? ignore this" | | P1 (password recovery design) | Essential |
| A2 | Your password was changed | The password changes by reset link, by the user on their profile, or by a root admin reset | The account's email | At once | When, how (reset, profile, admin), "wasn't you? reset it now" link | | P1 (password recovery design) | Essential |
| A3 | Welcome to Poolmaster | A new account is registered **without** an invitation (a commissioner signing up to start a league) | The new account | At once | Start a league button, how a league works in three lines | | P3 | Essential |
| A4 | Confirm your email address | Sign-up, if email verification is adopted (Q3.1) | The new account | At once | Confirm link | | P3 | Essential |
| A5 | Your email address was changed | The account's email is changed | The **old** address | At once | New address, "wasn't you?" link | | P2 | Essential |

**Q3.1 Verify email at sign-up?** Most people arrive through an invite sent to their address,
but they can register under a different one.
*Recommendation:* not now. A password reset proves ownership when it matters; leave the
decision to the password recovery design.

### B. Leagues, invites and membership

| # | Name | Trigger and conditions | Audience | Timing | Key content and links | Today | Priority | Class |
|---|---|---|---|---|---|---|---|---|
| B1 | League invitation | Commissioner invites an address by email; refused for current members | The invited address | At once | Inviter, league, message, expiry, Join league | ✅ `LEAGUE_MEMBER_INVITE` | – | Essential |
| B2 | League invitation (resent) | Commissioner presses Resend Invite on a pending email invite | The invited address | At once | Same as B1, new expiry | ✅ same template | – | Essential |
| B3 | Welcome to the league | An invitation is accepted (new squad or a restored one) | The person who joined | At once | League, their squad's name, League Home, the league's open contests if any | ✅ `LEAGUE_JOIN_SUCCESS` (open contests added in #903) | P2 | Essential |
| B4 | Co-owner invitation | Commissioner or squad owner invites an address to co-own a squad; a new address joins on sign-up | The invited address | At once | Who invited them, the squad's name, league, Accept button | ✅ `SQUAD_OWNER_INVITE`, also when an owner is replaced | P1 | Essential |
| B5 | You were added as a co-owner | Co-owner invite to an address that already has an account (added straight away) | That person | At once | Squad's name, league, League Home | ✅ `SQUAD_OWNER_ADDED`, names who added them | P2 | Essential |
| B6 | New member joined | An invitation is accepted | The league's commissioners, not the joiner | At once, or daily if more than three in a day | Who joined, their squad's name, member count, Teams and Owners link | | P2 | B |
| B7 | Invitation still pending | An email invite is pending and expires in 2 days | The commissioner who sent it | Once, 2 days before expiry | Who hasn't joined, Resend Invite link | | P3 | B |
| B8 | You're now a commissioner | A member is made commissioner | That person | At once | What commissioners can do, Commissioner tools link | | P3 | Essential |

**Q3.2 Tell someone they left a league?** Removing an owner or inactivating a squad ends
their membership.
*Recommendation:* no email. It is a commissioner's quiet admin act, often QA tidy-up, and an
email could start an argument the app can't help with.

### C. Events, for commissioners

A commissioner can only build a contest on a released event (`SCHEDULED`); a `DRAFT` event is
invisible to them. Whole seasons are loaded and released months ahead, so "released" alone
is the wrong moment to say "go set up your contest". These emails use the event's start date
instead. They go to every commissioner of every league (Q3.3).

| # | Name | Trigger and conditions | Audience | Timing | Key content and links | Today | Priority | Class |
|---|---|---|---|---|---|---|---|---|
| C1 | Coming up soon | An event of any sport league starts in 10 days; it may still be `DRAFT` | Every commissioner of every active league | Once, 10 days before start | "The Masters is next week. Get ready to set up your league's contest." Dates, last year's winner of your league's contest on it if any, link to the sport league's schedule | ✅ `EVENT_COMING_UP` (#893), queued 7 to 10 days out; links to the league's contests page, as no league page shows a sport league's schedule | P1 | B |
| C2 | Ready for contests | The event is released **and** starts within 7 days; fires at whichever comes later. Skipped for a league that already has a contest on it | Same as C1 | Once | "The Masters is ready. Set up your contest." Start date, field size, the default contest setups for it, Create contest button | ✅ `EVENT_READY_FOR_CONTESTS` (#893); a week season's first week only | P1 | B |
| C3 | No contest yet | 3 days before start, a league has no contest on the event | Same as C1 | Once | Short nudge, Create contest button | | P3 | B |
| C4 | Your contest isn't open yet | A league's contest on the event is still `DRAFT` 48 hours before its cutoff | That league's commissioners | Once, 48 h before cutoff | Contest name, "members can't enter until you open it", Open contest link | ✅ `CONTEST_NOT_OPEN` (#893), not for a contest created in the last 6 hours | P2 | B |
| C5 | Entries so far | A contest's cutoff is 24 hours away | That league's commissioners | Once | Entries submitted, members with none (names), Remind link (sends D2 now) | | P3 | B |
| C6 | Event postponed or rescheduled | A released event's start date changes, or it goes `POSTPONED` | Commissioners with a contest on it, plus members with an entry | At once | Old and new dates, what it means for picks (still open until the new start) | ✅ `CONTEST_EVENT_CHANGED` (#893): a move is told when an admin changes a released event's start; open and live contests only, never a draft | P2 | A |
| C7 | Event cancelled | An event goes `CANCELLED` | Commissioners with a contest on it, plus members with an entry | At once | "Cancelled: counts for nothing in [contest]." Not for a contest it leaves with no event to play (one-event, or the rest already cancelled): F2 tells it | ✅ `CONTEST_EVENT_CHANGED` (#893), queued before its contests settle; open and live contests only, never a draft | P2 | A |

**Q3.3 Which leagues get C1–C3?** **Decided (Derek 2026-10-21):** start simple. Every
commissioner of every active league gets them for every sport league's events, whether or not
the league has played that sport. Letting commissioners opt in to the sports and sport leagues
they want is a follow-up feature, #851. A commissioner who wants none can turn off the
Commissioner updates category meanwhile.
**#851 decided (Derek 2026-10-23):** the choice is a league setting, set by its commissioners.
A new league hears about every sport league, one email per event. A weekly digest the league
can choose instead replaces both C1 and C2. Part 1 (the league's muted sport leagues, filtering
C1 and C2) and part 2 (Event emails in Commissioner tools › League settings) are built. Part 3,
the digest (Derek 2026-10-24): the next 14 days by week, every league's at once on Monday at
3:00 AM US Eastern (`EMAIL_CONFIG.weeklyDigestHour`), nothing for an empty fortnight, events
with a contest listed as set up, no plan feature of its own, per-event stays the default.

**Q3.4 C1 and C2 timing.** **Decided (Derek 2026-10-21):** start with the basic case, one
email per event: C1 at 10 days, C2 at the later of release and 7 days before start, as above. A
weekly "coming up next week" digest, better for leagues that play many sports, is an option a
commissioner will choose in #851 alongside which sports they hear about. Football weeks (each NFL week is its own event) would fire every
week: for sport leagues whose events are weeks, send C1 once before the season's first week and
C2 once when the season's weeks are released, not per week.

**Q3.5 Who gets C6 and C7?** *Recommendation:* commissioners and everyone with an entry, as
listed. Members without an entry don't need to know.

### D. Contests, before they start

| # | Name | Trigger and conditions | Audience | Timing | Key content and links | Today | Priority | Class |
|---|---|---|---|---|---|---|---|---|
| D1 | New contest open | Commissioner opens a contest (`DRAFT` → `OPEN`) | Every active league member | At once | Contest name, event(s) and start, selection type in a line ("pick 6 golfers from 6 tiers"), entries per member, prizes if set, closes at, Enter contest button | | P1 | A |
| D2 | Entry reminder | The contest is `OPEN`, its cutoff is near, and the member has no submitted entry for the starting event (no entry, or a draft) | Members with nothing submitted | 48 h, 24 h and 3 h before cutoff, with the rules in Q3.6 | "Entries close Thursday 7:00 am." Their draft's status if they have one ("4 of 6 picked"), Make picks button | | P1 | B |
| D3 | Entry submitted | An entry's lineup is submitted for an event | Every owner of the squad | At once | Lineup, tiebreaker, "you can change picks until [time]", Entry link | ✅ `CONTEST_ENTRY_COMPLETED`: every entry type (#867) | P2 | A |
| D4 | Pick'em week submitted | A pick'em or survivor week is submitted | Every owner of the squad | At once | Their picks by game (confidence values), "each pick locks at its kickoff" | ✅ folded into D3 (#867) | P3 | A |
| D5 | A pick withdrew | A field member in a submitted lineup withdraws (or is scratched) while that event's picks are still open | Owners of entries holding that pick | At once, at most once per entry per event | Who withdrew, whether the lineup is now short (back to draft) and won't count unless fixed, Make picks button | | P2 | B |
| D6 | Your picks were drawn | A random draw contest's draw runs | Owners of every entry | At once | Their dealt picks, Leaderboard link | ✅ folded into D3 (#867), with an Entry link | P2 | A |
| D7 | Squares numbers drawn | A squares contest's numbers are drawn | Owners of every entry with a box | At once | Their boxes with their numbers, the grid link | ✅ folded into D3 (#867), with an Entry link | P2 | A |

**Q3.6 Reminder timing.** **Decided (Derek 2026-10-21):** three reminders, 48, 24 and 3 hours
before the cutoff, and none once something is submitted. The same schedule applies to every
cutoff: a one-event contest's start, each week of a pick'em or survivor contest (before that
week's first kickoff, to entries whose week is still a draft), each event of a season contest,
a second-chance bracket's starting round and a squares game's kickoff.

One schedule works for every format we have, with the two rules below, so there are no
per-sport schedule profiles. Format was not the problem when we checked each one; short
notice was:

1. **Too late is skipped.** A reminder whose time has passed when the contest opens, or that
   would land within 6 hours of the "New contest open" email (D1), is not sent. That covers a
   contest opened the day before, a bracket set on Selection Sunday for a Thursday tip-off, and
   a reseeded round set a few days ahead.
2. **Everyone at once.** **Decided (Derek 2026-10-21):** each reminder goes to every
   recipient at the same moment, on the schedule, with no per-person time zone shifting. Some
   readers will get one overnight; the other two reminders cover them.

The offsets (48, 24, 3) go in `EMAIL_CONFIG` as one list, so a root admin can change them on
the Settings page without a deploy. That is the "configurable someday" for almost no cost.
Profiles by sport or event type wait until a format turns up that these rules can't handle.
The likely case is daily events with cutoffs less than 48 hours apart, which no contest has
today.

**Q3.7 Should D1 go to members who already played the event last year only?**
*Recommendation:* no, every active member. Opening a contest is rare and it is the email a
league exists for.

### E. Live play

`ACTIVE` contests. Each standings email shows the **top 10** and the reader's own entries'
places when they are outside it, with movement since the last email.

| # | Name | Trigger and conditions | Audience | Timing | Key content and links | Today | Priority | Class |
|---|---|---|---|---|---|---|---|---|
| E1 | Contest is live, good luck | The contest goes `OPEN` → `ACTIVE` at its cutoff | Every active league member (Q3.8, decided) | At once | "Good luck, everyone." The event (dates, venue, rounds or games) and the contest's rules in a few lines (selection type, scoring, prizes), entry count, Leaderboard button. No list of entries (Q3.9, decided) | 🟡 `CONTEST_STARTED_SUMMARY` (no cap, no leaderboard link, no "good luck", entrants only) | P1 | B |
| E2 | Round standings | Every golfer still playing a stroke-play round has finished it (Q3.11) | Every league member with an entry, plus commissioners | Once per round, after the buffer (Q3.11); not after the final round (F1 covers it) | "After round 2 of the Masters." Top 10 with movement, the reader's entries, cut news for their picks, Leaderboard button | ✅ `CONTEST_STANDINGS` (#877) | P1 | B |
| E3 | Week results | A pick'em or survivor week settles | Same as E2 | Once per week, after the buffer; not for the last week | The week's winner (#717), the week's top 10, contest standings top 10, next week's first kickoff, Make picks for next week button | ✅ `CONTEST_STANDINGS` (#877) | P1 | B |
| E4 | Bracket round results | Every match of a bracket round has a result | Same as E2 | Once per round, after the buffer; not after the final | Top 10, the reader's busted picks and remaining champions, next round's start, Bracket link | ✅ `CONTEST_STANDINGS` (#877) | P1 | B |
| E5 | You're out | A survivor entry is eliminated (losing pick, a draw where draws knock you out, or no unused team left) | Owners of that entry | With E3 | Which week and pick, how many are left, Leaderboard link | ✅ folded into E3 as the reader's own lines (#877) | P2 | B |
| E6 | Event results in a season contest | One event of a multi-event roster contest (a majors pool) settles and more events remain | Same as E2 | Once per event, after the buffer | That event's result for each entry, contest standings top 10, next event and its pick deadline | ✅ `CONTEST_STANDINGS` (#877) | P2 | B |
| E7 | Squares quarter winner | A squares contest's scoring moment is decided (end of a quarter) | Every entry owner on the board | Once per quarter, not the final one | Winning numbers and box, who holds it, Grid link | | P3 | B |
| E8 | Next round is set | A reseeded or second-chance round's matchups are set, and picks are open for it | Owners of entries that pick that round | At once | The round's games, picks close at, Make picks button | | P2 | B |

**Q3.8 Who gets E1?** Today it goes to commissioners and squads with an entry.
**Decided (Derek 2026-10-21):** every active member, with a line for those not in it ("You're
not in this one. Follow along on the leaderboard."). Members without an entry can still watch
the leaderboard, and it reminds them to enter next time.

**Q3.9 Entries in E1.** **Decided (Derek 2026-10-21):** none. E1 describes the event and the
contest's rules and links to the leaderboard. Listing some entries would pick an arbitrary few;
the top 10 is a real order, so it starts with the standings emails (E2–E4).

**Q3.10 One-day racing.** A horse race, a NASCAR race or a marathon is one round.
*Recommendation:* no E2 for single-round events; E1 then F1 is the whole story.

**Q3.11 When a round counts as finished.** **Decided (Derek 2026-10-21):** standings emails
fire from what actually happened, never from a scheduled end, plus a buffer (30 minutes by
default, in `EMAIL_CONFIG`) so a late correction lands first. What "finished" reads in each
shape:

- **Event (F1, E6):** the event is `COMPLETED` and its contests have settled. Recorded today.
- **Pick'em or survivor week (E3), bracket round (E4):** the last game of the week or round
  gets its result (or is cancelled). Each game records its own result, so the moment is known
  when that result is entered.
- **Golf round (E2):** there is no round-level "finished" record; each golfer's round is
  marked complete on its own (`SportEventParticipantRound`, with `completedAt`). A round is
  finished when every golfer still playing it (cut and withdrawn golfers left out) has
  completed it, and it finished at the latest of their `completedAt` times. A weather delay
  that carries a round into the next morning simply finishes it then. Slice 3 derives this;
  no new column is needed.

The lifecycle scheduler sends each email on its first sweep after "finished" plus the buffer.

### F. Settlement

| # | Name | Trigger and conditions | Audience | Timing | Key content and links | Today | Priority | Class |
|---|---|---|---|---|---|---|---|---|
| F1 | Final results and winners | The contest settles (`ACTIVE` → `COMPLETED`) with scores | Every active league member | At once | Winners (places 1–3 and ties), prizes as set (paid outside Poolmaster), final top 10, the reader's entries' places, Final leaderboard button | ✅ `CONTEST_RESULTS` (slice 4): names the entries placed first, then the final top 10 and the reader's entries below it; no prizes yet (F4) | P1 | A |
| F2 | Contest ended with no scores | Every event of the contest was cancelled | Commissioners and members with an entry | At once | "Every event was cancelled, so [contest] ends with no scores." | ✅ `CONTEST_RESULTS` (slice 4), for any contest that completes with no places; a one-event contest names its cancelled event; a squares game not played says only that it ended with no scores | P2 | A |
| F3 | You won | The reader's entry finished first (or tied first) | That entry's owners | With F1, folded into it as a personal line | "Congratulations, [squad] won [contest]." | ✅ folded into F1 (slice 4) | P2 (part of F1) | A |
| F4 | Settle up | The contest settles with prizes defined | The league's commissioners | With F1 | Prize table with each winner's squad and owners' names, reminder that payment is outside Poolmaster | | P3 | B |
| F5 | Year in review | The commissioner presses Send the year in review, from 1 January for the year before (season-cups plan Q6) | Each active owner of an active squad that placed that year | Once per league and year | The squad's championship place and points, its contest 1sts, 2nds and 3rds, the cups it placed in, its trophies, See your year button | ✅ `YEAR_IN_REVIEW` (#872 slice 4), Results category | P2 | B |

**Q3.12 Score corrections after settlement.** A settled result never changes, so there is
nothing to re-send. *Recommendation:* no email.

### G. Root admin (operations)

| # | Name | Trigger and conditions | Audience | Timing | Key content and links | Today | Priority | Class |
|---|---|---|---|---|---|---|---|---|
| G1 | Event still in draft | An event starts in 7 days and is still `DRAFT` | Root admins | Once, then daily until released | Event, what's missing for release (field, tiers, prices), Event admin link | ✅ `EVENT_STILL_DRAFT` (#893), category Root admin; the list is the release refusal's own | P2 | Essential |
| G2 | Email delivery problems | Bounces or complaints from the email provider in the last day | Root admins | Daily, only when there are any | Count by template, addresses suppressed | | P2 (sending design) | Essential |

Later, not now: cup standings and "crowned champion" emails belong to season cups (#841), and a
season recap belongs to league history (#837). Each design adds its rows to this catalog when
it is built, as class B.

---

## 4. What the sending design provides

All decided in `plans/email-delivery-ses.md` (#844), not here: templates as typed renderers in
code (copy changes go through a PR; SES only delivers), one email per recipient through an outbox
that never holds a request open, the sent record and idempotency key (§2 rule 2), the
preference switches for the categories above, one-click unsubscribe with `List-Unsubscribe`
headers, no Reply-To, and bounce and complaint handling.

---

## 5. Slices

Each slice is one PR. The order across this plan and the SES design is in
`plans/email-delivery-ses.md` §10: SES 1 and 2 first, then SES 3 alongside slice 1 here, then
SES 4 and 5, then slices 2 to 6 here.

1. **Foundation and reminders.** A "notifications due" step in the lifecycle scheduler sweep,
   the reminder offsets in `EMAIL_CONFIG`, and D2 reminders as the step's first email, for the
   formats whose members submit (tiered, budget, pick'em, bracket), so the step does real work
   from the start. A reminder more than an hour past its time is skipped, which covers a contest
   opened after it. The categories are registered in SES slice 2; the sent record, preferences
   and unsubscribe come from #844. The standings buffer setting arrives with slice 3, which first
   reads it.
2. **Contest lifecycle**, in two PRs. 2a: D1 contest open (with the contest's opening time
   kept on the contest), the "no reminder within 6 hours of D1" rule, E1 upgraded (all members,
   "good luck", event and rules summary instead of the entry list, leaderboard link), D3 to
   every owner with "you can change picks until", and the web app's contest rules wording moved
   to the shared package so the emails say the same thing. 2b: D2 for survivor (live entries
   only), random draw (members with no entry, "Entries close soon") and squares (members with
   no box, "Boxes close soon"), and the draft's progress in the reminder ("4 of 6 picked" for a
   member's only draft in a roster, pick'em or bracket contest; a member with several drafts is
   told how many).
   2c (#867, Derek 2026-10-22): an entry receipt (D3) for every entry type, to every squad
   owner, each showing that entry's content: pick'em, bracket, survivor, random draw (at the
   draw) and squares. Pick'em, bracket and survivor receipts come from the selections module's
   submit through `EntryReceipts` in the notifications module. Random draw and squares have no
   submit: their receipts go out at their draw, which folds D6 and D7 into D3; claiming a box
   sends nothing.
3. **Live standings** (#877), in three PRs, all one `CONTEST_STANDINGS` email. Part 1: the
   standings buffer in `EMAIL_CONFIG`, each entry's place recorded with every standings email so
   the next one shows movement, E2 round and E6 season event. Part 2: E3 week and E5
   eliminations. Part 3: E4 bracket round. Each with the top 10 and the reader's entries.
4. **Final results.** F1 with F3 folded in, F2: one `CONTEST_RESULTS` email, queued by
   `ContestSettlementService` the moment it completes a contest.
5. **Commissioner event emails.** C1, C2, C4, C6, C7, G1, to every commissioner. Choosing sport leagues is #851.
6. **League and account gaps.** B4 and B5 co-owner emails, B3 with open contests, B6, A5. A1
   and A2 come with password recovery.

P3 rows (A3, A4, B7, B8, C3, C5, E7, F4) wait until a league asks.
