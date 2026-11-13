# ADR 0011: Once a League's Provider Sync Is Live, the Sync Creates Its Events

- **Status:** Accepted
- **Date:** 2026-11-13
- **Supersedes:** [ADR-0009](./0009-admin-authored-events-score-only-linking.md)

## Context

ADR 0009 (2026-10-07) made the admin the author of every event: an admin creates each event
(by hand, from one browsed provider event, or with a tour's year import), links it to a
provider event, and the provider only sends scores and an on-demand field to linked events.
It came out of epic #122, which removed the old sync paths (scheduled event lists, scheduled
results, the rankings feed, the provider-owned `FULL` scope) because they ran against a mock
feed, overwrote what admins set, and confused analysis.

That was a moment in the site's build, not its destination. No real provider existed then; the
admin event pages and admin result entry were how the site got events and results at all. Since
then epic #1494 has built a real provider (BALLDONTLIE) with a reader per league, webhooks and a
safety-net sweep, and Derek has said (2026-11-11 and 2026-11-13) that admin result entry and
admin event authoring were a stop gap until sync was ready. Keeping "an admin authors every
event" as the rule would leave a person keying in, or pressing import for, every week of every
league that a feed already describes.

## Decision

**For a sport league whose provider sync is live, the sync is the source of its events: it
creates them, loads their participants, and keeps them current, and the event's status follows
its dates. The admin reviews, releases and browses; admin authoring and admin result entry are a
fallback for leagues with no feed and for corrections.**

- **Events.** The sync creates a league's events from the provider (the provider's events, or
  the scope ids an adapter invents for a provider that has games but no events, such as an NFL
  week), linked to that provider event, without an admin action. It goes through the same event
  service the admin's year import uses, so the series, rounds and default tiers are seeded the
  same way.
- **Participants.** The sync loads and refreshes each event's field without an admin pressing
  "Load Participant Field".
- **Status.** An event moves `SCHEDULED → IN_PROGRESS → COMPLETED` from its dates by the
  lifecycle scheduler, as today. For a synced event those dates come from the provider and the
  sync keeps them current, so a rescheduled game or tournament moves with it.
- **Release stays deliberate.** A new event is born `DRAFT`, as every event is, and is released
  to commissioners by an explicit step (the draft-and-release decision of 2026-10-07). Whether
  that step stays an admin's press or becomes automatic for a synced league is decided with the
  follow-up work, not here.
- **The admin.** The root admin event pages become mainly read and browse for synced leagues:
  what the sync created, its field, its sync history, its scores. Creating, editing and entering
  results by hand remain for leagues with no feed (racing, cycling, marathons and the other
  "Load sport data" leagues) and for correcting a feed's mistake, which the existing result
  source label (`resultSource` `ADMIN` / `PROVIDER`) already records.

This applies league by league: a league is synced only once its reader is built and its provider
is configured. Until then, and for leagues no provider covers, ADR 0009's admin-authored path is
how the league gets its events.

## Consequences

- A new season, week or tournament appears on the site without anyone keying it in, and the
  admin's job shifts from data entry to review.
- The provider becomes the owner of the facts it feeds for a synced event: name, dates,
  participants, games and results. An admin edit to one of those can be overwritten by the next
  sync; the follow-up work decides which fields an admin may still change on a synced event and
  how a deliberate correction survives a sync, the way `resultSource` already does for results.
- ADR 0009's rule that a sync never creates an event, never writes an event's details and never
  creates a round is lifted for synced leagues. The code still enforces it until the follow-up
  tickets change it; the docs say which parts exist today.
- The retired paths are **not** revived. Event creation is built on the current per-league
  readers (scope ids, `match_keyword`, the shared writers), not by re-adding `EVENTSCHEDULE`,
  `EVENTRESULTS`, the rankings feed or the `FULL` sync scope.
- A synced league with a quiet or wrong feed now shows the problem as missing or wrong events,
  not just missing scores, so sync health (the quiet alert, sync history) matters more.

## Alternatives considered

- **Keep ADR 0009: admins author every event, sync only feeds.** Rejected: it was right with
  no real provider, but with one it makes a person repeat what the feed already knows.
- **Keep the admin year import as the only creation path, and just make it easier.** Rejected
  as the end state: it still needs someone to remember each season and league. It stays as the
  manual fallback.
- **Let the sync release events to commissioners on its own.** Not decided here; release is
  explicit today and changing it is its own decision.
