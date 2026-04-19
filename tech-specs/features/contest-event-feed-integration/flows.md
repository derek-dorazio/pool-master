# Contest Event Feed Integration Flows

## End-To-End Flow

### Flow 1: Root Admin Syncs Event

1. Root admin chooses sport/provider/event.
2. PoolMaster imports event metadata and participant field.
3. PoolMaster creates or matches normalized participants.
4. PoolMaster persists `SportEvent`, `SportEventParticipant`, source data, and
   derivation inputs.
5. PoolMaster resolves and persists `releaseAt` and `fieldLocksAt`.
6. PoolMaster computes event readiness.

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
3. User edits the entry using the contest-facing field.
4. PoolMaster validates against contest rules and lock state.
5. Entry remains editable until contest lock.
6. Participant status changes before lock are informational unless the member
   decides to change the entry.

### Flow 5: Event Updates Propagate Downstream

1. PoolMaster refreshes event/participant data from the provider.
2. PoolMaster updates readiness and event status.
3. PoolMaster identifies impacted contests.
4. PoolMaster updates contest lifecycle state and scoring/read models as
   appropriate.

## Key Design Decision

The same upstream event-field model should serve:

- commissioner contest setup
- team entry selection
- scoring/read-model propagation

without fragmenting into separate incompatible participant universes.
