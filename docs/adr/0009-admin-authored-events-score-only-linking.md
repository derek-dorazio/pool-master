# ADR 0009: Admin-Authored Events and Score-Only Linking Are the Only Provider Pattern

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

PoolMaster used to let provider sync drive its data. A scheduled `EVENTSCHEDULE` feed listed
provider events and created or updated PoolMaster events from them, moving their status. A
scheduled `EVENTRESULTS` feed fetched final results. A scheduled `PARTICIPANTRANKINGS` feed
filled a `ParticipantRankingSnapshot` history table, and a scheduled `EVENTPARTICIPANTS` feed
refreshed every linked event's field. Admin screens offered sport-level sync to run the same
feeds by hand.

That model confused analysis and got in the way of a better design. A provider's list of
events is not PoolMaster's list of tournaments: sports, tours and providers disagree, some
feeds do not exist for some leagues, and a feed that rewrites data on a schedule overwrites
what an admin deliberately set. The golf admin work kept narrowing what sync was needed for,
and epic #122 settled it: the admin creates and links events, and sync's only indispensable
job is live scores for an event that is already linked.

Epic #122 carried most of that out: field sync defaulted off (#123), the rankings feed and its
table deleted (#125), the schedule and results feeds and sport-level sync deleted (#126), and
the sync pages reduced to per-event sync (#130).

## Decision

**Every PoolMaster event is authored by an admin, and a provider only ever supplies scores and
other data to an event an admin has linked to it.**

- An admin creates an event (by hand, from one browsed provider event, or with a tour's year
  import), and links it to a provider event (`providerId` + `externalId`) to receive scores.
- `EVENTLIVESCORES` is the only feed that runs on a schedule by default, and it only touches
  linked events.
- A provider's field and odds are an on-demand complement: an admin loads or refreshes them
  for one linked event. The scheduled field sync exists but is off unless an admin turns it
  on.
- Listing a provider's events (`getUpcomingEvents`) is a lookup behind an admin action:
  browse, link, or import. It never creates, updates or changes the status of an event on its
  own.
- Event lifecycle moves are the admin's: by hand, or by the automatic lifecycle, which is on
  for an event unless the admin turns it off. They are never a provider feed's.

Sync-driven event creation, scheduled event lists, scheduled results and the rankings feed are
**removed, not legacy**. There is no switch to turn them back on, and they are not kept as a
fallback.

## Current state: one provider-owned path remains

The decision is not fully true on `main` yet. The provider-owned sync scope
(`SportEventSyncScope.FULL`) still exists:

- It is the column default, and every event that existed before the sync scopes were added
  was set to it.
- For a `FULL` event, every field load or refresh (`EVENTPARTICIPANTS`) overwrites the
  event's name, venue, dates, rounds and timing, and moves its status with a provider actor.
- The scheduled field sync targets only `FULL` events.
- Admins cannot edit a `FULL` event, and the automatic lifecycle skips it.

`FULL` is the one remaining provider-owned path. It is due for removal under #435, which
backfills existing events to `SCORES_ONLY` or `NONE`, changes the default and deletes the
provider-owned branches. Until then, no new event may be created as `FULL`, and no new code may
depend on it.

## Consequences

- Once #435 lands, one path creates events and one path feeds them scores, so a reader of the
  sync code or the data never has to ask whether a row came from an admin or a feed.
- Admin edits to an event, its field or its rankings stay put; nothing on a schedule
  overwrites them except a feed an admin turned on. Until #435, `FULL` events are the
  exception.
- A sport or league whose provider has no field or odds feed is a normal case, not an error.
- Admins do more by hand: they create or import each season's events and load each field.
  The tour year import (#385) and field load (#384) keep that cheap.
- New provider work must fit this shape: a new feed is either scores for a linked event or an
  on-demand complement an admin triggers for one event. A feed that would create events or
  write data across events on a schedule is a new decision, recorded in a new ADR, not a
  re-enabled old path.

## Alternatives considered

- **Keep the retired feeds off by default but in the code.** Rejected: "legacy, disabled"
  invites someone to re-enable them, and the dead paths kept costing review and test effort.
- **Let sync create events and have admins edit them afterwards.** Rejected during the golf
  admin design: sync then owns the event, and every admin edit races the next sync.
