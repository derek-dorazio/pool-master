# Plan 46 Companion: Site Administration User Cases

## Purpose

Capture the necessary use cases for non-commissioner site administration after
the league-first administration review.

This document is intentionally narrow. Site administration should remain a small
platform-operations surface and should not absorb league-owned product behavior
that belongs in commissioner tools.

## Guiding Principle

Site administration exists only for capabilities that are truly outside league
scope.

In the current simplified direction, that means:

- provider/feed operations
- ingestion operations
- platform health and alerts
- migrations
- limited platform configuration
- platform audit

Anything league-owned should be handled through commissioner tools, with root
admin acting as a super-commissioner when necessary.

## Primary Actors

- Root Admin / System Admin

## Core Site Administration Use Cases

### SA-001: Site admin manages provider and feed operations

Actor:
- Root Admin / System Admin

Goal:
- maintain external data providers and ingestion health

Flow:
1. Site admin opens provider operations.
2. Site admin reviews provider configuration, health, mappings, and ingestion state.
3. Site admin updates provider config or triggers operational maintenance as needed.

Notes:
- this is a true platform concern
- it does not belong in commissioner tools

### SA-002: Site admin manages ingestion schedules and platform polling behavior

Actor:
- Root Admin / System Admin

Goal:
- control platform-level data refresh behavior

Flow:
1. Site admin opens platform configuration.
2. Site admin updates ingestion intervals, polling behavior, or other runtime defaults.
3. Backend persists those settings as platform configuration.

Notes:
- keep this surface minimal
- only true operational defaults belong here

### SA-003: Site admin reviews platform health and errors

Actor:
- Root Admin / System Admin

Goal:
- monitor platform health and troubleshoot operational problems

Flow:
1. Site admin opens health and alert views.
2. Site admin reviews service health, infrastructure signals, provider issues, and errors.
3. Site admin takes corrective platform actions as needed.

### SA-004: Site admin manages migration runs

Actor:
- Root Admin / System Admin

Goal:
- run or monitor platform migration jobs and maintenance operations

Flow:
1. Site admin opens migration operations.
2. Site admin reviews available migrations and prior runs.
3. Site admin starts, monitors, or cancels migration runs as needed.

Notes:
- this is especially important during major backend refactors

### SA-005: Site admin reviews platform audit activity

Actor:
- Root Admin / System Admin

Goal:
- review and verify high-impact system-admin actions

Flow:
1. Site admin opens platform audit.
2. Site admin filters and reviews platform operations.
3. Site admin uses the audit trail for accountability and troubleshooting.

## Explicitly Out Of Scope For Site Administration

These should not shape first-pass site-admin design:

- league member management
- league invitations
- contest administration for a specific league
- contest entry correction for a specific league
- squad administration
- commissioner role changes inside a league

Those belong in commissioner tools, not site administration.

## Deferred Or Removed Site-Admin Ideas

The following are deferred or intentionally removed for now and should not drive
implementation choices:

- flags
- announcements
- support quick actions
- tenant administration
- tenant exports
- tenant plan controls
- tenant retention overrides

These can return later only if a future design proves they are necessary.
