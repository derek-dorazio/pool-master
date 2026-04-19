# Contest Event Feed Integration Flows

## End-To-End Flow

### Flow 1: Event Import Resolves Operational Timing

1. PoolMaster imports event metadata and participant field from the provider.
2. PoolMaster creates or matches normalized participants.
3. PoolMaster persists `SportEvent`, `SportEventParticipant`, source data, and
   derivation inputs.
4. PoolMaster resolves and persists `releaseAt` and `fieldLocksAt`.
5. PoolMaster computes event readiness.

Root-admin action in this flow is optional and operational:
- monitor imports
- retry a broken sync
- rarely override event timing if a special case requires it

### Flow 2: Commissioner Creates Contest

1. Commissioner opens league contest creation.
2. PoolMaster offers only contest-eligible events.
3. PoolMaster preselects the default seeded template for the sport/contest
   style and shows any other seeded template options.
4. Commissioner accepts a template or opens advanced configuration.
5. PoolMaster saves the contest and its configuration instance.
6. PoolMaster derives the contest-facing field behavior from:
   - event field
   - valuations/rankings
   - contest configuration

### Flow 3: Contest Creation Finalizes The Released Contest Field

1. Commissioner reviews the derived contest behavior during setup.
2. Commissioner completes contest creation.
3. PoolMaster freezes the new contest's field interpretation.
4. PoolMaster creates the contest in an entry-ready state.
5. Team entry creation becomes available immediately.

### Flow 4: Team Creates And Edits Entries

1. User starts `Create entry` in team context.
2. PoolMaster creates a uniquely named entry.
3. PoolMaster returns the frozen contest-facing field grouped for the contest
   type.
4. For first-pass tiered golf, PoolMaster shows tiers/groups, participant
   ordering derived from tournament-winning odds, supporting world-rank context,
   and winner-score tiebreaker input.
5. User selects through the tiers sequentially and saves the entry.
6. PoolMaster validates against contest rules, lock state, and tier/group
   constraints.
7. Entry remains editable until contest lock.
8. Participant status changes before lock are informational unless the member
   decides to change the entry.

### Flow 4A: Locked Entry Becomes Read-Only Detail

1. Contest reaches lock.
2. PoolMaster freezes entry editing.
3. The same entry surface now behaves as read-only standings/detail.
4. Users can inspect selected participants and scoring detail, but cannot
   change the entry.

### Flow 5: Event Updates Propagate Downstream

1. Scheduled backend jobs poll providers for event updates.
2. PoolMaster refreshes event and event-participant data using latest fetched
   provider truth for the affected records.
3. PoolMaster identifies impacted contests and entries.
4. PoolMaster recalculates entry scores from the frozen contest field plus the
   latest event-participant facts.
5. PoolMaster refreshes leaderboard ordering and entry-detail read models.
6. PoolMaster updates contest lifecycle/read models as appropriate.

### Flow 6: Contest Completes And Enters History

1. Event reaches final completion.
2. PoolMaster finalizes contest standings and winners.
3. Contest leaderboard becomes the final leaderboard view.
4. Contest is included in league completed-contest history.

There is no normal user flow in this step:
- no commissioner action
- no member action
- no root-admin action unless a provider feed is broken and needs an
  operational rerun or repair

First-pass operational visibility should stay thin:
- read-only sync-run visibility
- datetime and status per run
- retry/rerun controls can be added later after real provider behavior is
  better understood

## Key Design Decision

The same upstream event-field model should serve:

- commissioner contest setup
- team entry selection
- scoring/read-model propagation

without fragmenting into separate incompatible participant universes.
