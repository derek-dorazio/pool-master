# Random-draw (sweepstake) selection

**Tracking issue:** #601 (part of #599)

Written 2026-10-13. The issue describes the product: the office sweepstake, where each entry is
dealt members of the field at random and nobody picks. This file records how it fits the
model and the defaults chosen where the issue left a question open. Questions sit under the
section they belong to, each with the default that was built; none blocks the work.

## 1. Where it sits

A new `SelectionType.RANDOM_DRAW` with its own selection engine. Scoring does not change: the
dealt picks are ordinary `contest_entry_picks` rows, so the sport's scoring family (stroke play
for golf) scores them and the best `countedScores` count, exactly as in a tiered or budget
contest. Golf's sport definition lists the new type, so a Masters sweepstake needs nothing else.

The selection engine seam was built for this: the engine decides what a selection does, and
for a draw every selection is refused, because the draw deals the picks. The shared selection
room still lists the field and the entry's picks, so members see what they were dealt in the
same place they would see a lineup.

## 2. Rules

`{ selectionType: RANDOM_DRAW, picksPerEntry, countedScores }`.

- `picksPerEntry` is how many members of the field each entry is dealt, 1 to 12 (the budget
  roster's ceiling). The commissioner chooses it; the issue's example of big fields with several
  golfers per entry is the reason it is not fixed at one.
- `countedScores` is the same best-N rule as the other types, at most `picksPerEntry`.

## 3. Lifecycle

1. The commissioner creates the contest and opens it, as today.
2. Members enter. An entry holds no picks and cannot make any; it waits for the draw.
3. The commissioner presses **Run draw**: after entries are in, before the event starts. This
   is an explicit release action, like opening a contest; nothing runs on a timer.
4. The draw deals every entry `picksPerEntry` picks, submits every entry, and closes entries.
   From then on nobody can enter, leave, or rename, and every member can see every entry's
   picks: a sweepstake draw is public by nature, so picks are revealed at the draw rather than
   at tee-off.
5. The event starts and the contest goes live and settles as any other.

The draw is refused when the contest is not open, the event has started, there are no entries,
or the field (its available members) is smaller than `entries × picksPerEntry`. It is final:
there is no undo and no redraw.

## 4. The deal

- The field is the event's available participants (withdrawn golfers are not dealt), ordered
  by id so the input is the same on every replay.
- A random seed is drawn per contest. A deterministic shuffle keyed by the seed orders the field
  and, separately, the entries.
- The shuffled field is dealt round-robin to the shuffled entries, one card each per round,
  for `picksPerEntry` rounds. Every entry gets the same count. Field members left after the
  last round are not dealt.
- **Auditable:** the draw is stored in its own `contest_draws` row (seed, the dealt order of the
  field, who ran it and when), so it can be shown and replayed.

Picks are exclusive by construction: each field member is dealt at most once.

## 5. Open questions (defaults built)

- **Q1 Leftovers** when the field does not divide evenly: left undealt (built). Paper sweeps do
  the same, and it keeps every entry's count equal.
- **Q2 Seeded draw** (one pick from each tier, so everyone gets a favourite and a long shot):
  not in the first slice. The plain draw is the default either way; the seeded option is a
  follow-up on the same `contest_draws` record.
- **Q3 Entries after the draw:** refused (built). Entries close at the draw.
- **Q4 Withdrawals after the draw:** no redraw (built). A dealt golfer who withdraws scores by
  the sport's normal withdrawn rules, as in any other contest.

## 6. Slices

1. The type end to end, in one slice because the web's exhaustive maps over `SelectionType`
   must handle a new value in the same change: enum and migrations (two golf presets), rules
   schema, engine, draw service and endpoint, entry window and reveal rules, golf allows the
   type; on the web, the type on create and edit contest, **Run draw** on the manage page, and
   the entry page showing dealt picks in place of the picker; tests at every layer.
2. Seeded draw (Q2), if wanted.
