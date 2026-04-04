# Smoke Test Reset

> **Planning Note (2026-04-03):** Re-analyze the current MVP product scope, deployed environment capabilities, and live route contracts before changing this plan. Do not restore the deleted legacy smoke suites verbatim.

## Purpose

Rebuild API smoke coverage as a small black-box deployed confidence layer for the narrowed MVP.

This layer should answer one question:

> "Is the deployed product usable for the current MVP path right now?"

It should not try to exhaustively test every sport, contest family, or historical feature.

## Why The Old Smoke Layer Was Reset

The deleted smoke suites were low-signal because they:

- assumed ambient or seeded data existed in the target environment
- used fake UUIDs for draft state instead of real created resources
- tolerated broad fallback status codes on critical checks
- targeted deferred or non-MVP areas like billing depth and broad search/discovery assumptions
- mixed outdated product assumptions with current routes

## Smoke Test Principles

- Treat smoke as deployed black-box validation only.
- Create the minimum live data needed through real routes.
- Do not rely on seed fixtures, discovery catalogs, or preexisting contest state.
- Keep the suite small, durable, and fast enough to run post-deploy.
- Assert only critical user-value outcomes, but assert them strongly.

## MVP Smoke Scope

### API Smoke

1. Health
   - service health endpoint responds

2. Auth
   - register or login works
   - authenticated profile fetch works

3. League + Invite
   - create league
   - generate invite link
   - second user accepts invite
   - members are visible

4. Contest Creation
   - create one supported MVP contest via real routes
   - contest is visible and has expected core fields

5. Contest Entry + Selection
   - current user enters contest
   - read room state for one supported MVP selection type
   - submit one real selection
   - verify read-after-write room state

6. Standings / Results Read
   - verify live standings or historical result surface for the same created flow when feasible
   - if a deployed environment does not produce results inline, keep this step to a truthful read assertion rather than a fake score submission

## Explicitly Out Of Scope

- full sport matrix coverage
- season-long contest families
- bracket and deferred contest families
- billing smoke
- broad discovery/search smoke that assumes ambient data
- notification and admin depth unless they are part of the active MVP

## File Layout

- `tests/api/core-api/*.smoke.ts`
- `tests/api/functional/*.smoke.ts`
- shared setup should stay in `tests/api/setup.ts`

## Rebuild Order

1. API smoke baseline
   - Status: Done
   - health
   - auth
   - league + invite

2. MVP contest smoke
   - Status: Done
   - create contest
   - verify list/detail/update/delete over live routes

3. MVP standings/results smoke
   - Status: Deferred until the product exposes a self-owned live results path
   - verify downstream read surface from the created contest flow when the route exists

## Current Implementation Notes

- `tests/api/functional/mvp-baseline.smoke.ts` covers auth, league create, invite generation, invite acceptance, and membership visibility.
- `tests/api/functional/contest-lifecycle.smoke.ts` covers contest create, list, detail, update, delete, and post-delete 404 verification.
- A fully self-owned API smoke for room selection/results is not yet feasible from public routes alone because the current API does not expose a public sport-create/setup path, and the MVP smoke policy forbids relying on seed data.

## Acceptance Criteria

- Legacy API smoke suites remain deleted.
- Replacement smoke suites create their own live data through deployed routes.
- Smoke coverage stays aligned to the narrowed MVP only.
- Smoke failures point to real deployment breakage rather than seed-data drift.

## Follow-Up

- See [smoke-and-e2e-strategic-expansion.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/testing/smoke-and-e2e-strategic-expansion.md) for the later route/service expansion plan and staged promotion strategy.
