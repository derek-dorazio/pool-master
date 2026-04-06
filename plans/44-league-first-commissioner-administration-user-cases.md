# Plan 44 Companion: League-First Commissioner Administration User Cases

## Purpose

Capture the guiding product model for administration after the league-first
domain simplification.

The core principle is:

- administration should primarily happen through league-scoped commissioner tools
- root/system administrators should act as super-commissioners for any league
- only a small set of truly league-independent platform capabilities should
  remain outside league-scoped administration

This document should guide future backend and UI work so that agents do not keep
designing administration around a separate tenant-first admin application by
default.

## Guiding Principles

### Principle A: Commissioners administer their leagues

Commissioners should be able to administer everything that belongs to their
league.

That includes the majority of product behavior because most app data is
league-scoped once the model is simplified.

Examples:

- league settings
- league members
- member roles
- invitations
- squads
- contests
- contest configuration
- contest entries
- scoring operations that are league-owned
- prize configuration and review

### Principle B: Users switch leagues, not tenants

Users who belong to multiple leagues should have a league selector in the UI.

Switching leagues should:

- change the active league context
- refetch league-scoped state
- refetch the user's role for that league
- refetch league-specific commissioner capabilities

### Principle C: Commissioner capability is per-league

If a user is a commissioner in multiple leagues, they should see commissioner
tools in each league where they hold that role.

Authorization should be checked against:

- the active league
- the user's role in that league

### Principle D: Root admin is a super-commissioner

A root admin should implicitly have commissioner capability in every league.

That means a root admin should be able to:

- select any league
- access commissioner tools for that league
- use league-scoped commissioner APIs for that league

### Principle E: Only true platform concerns stay outside league scope

Only a small number of capabilities should remain league-independent:

- provider/feed configuration and monitoring
- ingestion scheduling and operational controls
- platform health/alerts
- migrations and deploy-time maintenance tooling
- audit for site-admin actions
- a small future billing configuration surface when paid tiers matter

These are system admin tools, not everyday product administration.

## Primary Actors

- League Member
- Commissioner
- Root Admin / System Admin

## Core User Cases

### A-001: User switches active league

Actor:
- League Member or Commissioner

Goal:
- move between leagues they belong to

Flow:
1. User opens league selector.
2. User chooses a different league.
3. App updates active league context.
4. App refetches league-scoped state and role/capability information.

Notes:
- switching leagues is the modern replacement for tenant-switching behavior

### A-002: Commissioner opens league administration

Actor:
- Commissioner

Goal:
- manage league-owned settings and operations

Flow:
1. User selects a league where they are a commissioner.
2. App shows commissioner tools for that league.
3. Commissioner performs league-owned actions through league-scoped APIs.

### A-003: Commissioner promotes or demotes another member

Actor:
- Commissioner

Goal:
- manage commissioner capability inside a league

Flow:
1. Commissioner opens league member management.
2. Commissioner changes a member role between `MEMBER` and `COMMISSIONER`.
3. Backend validates league-scoped commissioner rights.
4. Member role updates for that league only.

### A-004: Root admin acts as commissioner for any league

Actor:
- Root Admin

Goal:
- administer any league without a separate product administration path

Flow:
1. Root admin selects any league in the system.
2. App treats root admin as a super-commissioner for that league.
3. Root admin uses the same commissioner tools and APIs as a normal commissioner.

Notes:
- this should be the default operational path for most admin intervention

### A-005: System admin configures provider/feed operations

Actor:
- Root Admin / System Admin

Goal:
- manage platform-level ingestion and provider behavior

Flow:
1. Admin opens provider/ingestion controls.
2. Admin reviews provider health, schedules, and mappings.
3. Admin updates provider configuration or reruns ingestion as needed.

Notes:
- this is a true platform concern
- it does not belong inside league commissioner tools

### A-006: System admin reviews platform health and operational issues

Actor:
- Root Admin / System Admin

Goal:
- monitor service health and troubleshoot operational incidents

Flow:
1. Admin opens health/alerts/errors tools.
2. Admin reviews infrastructure/service/provider issues.
3. Admin takes platform-level corrective action where needed.

### A-007: System admin manages platform configuration

Actor:
- Root Admin / System Admin

Goal:
- manage global operational or platform defaults

Examples:
- ingestion schedules
- notification channel defaults
- rate limits
- global template defaults
- push-trigger behavior

Notes:
- these are not league-owned settings
- they should remain outside commissioner tools

### A-008: Site admin reviews platform audit

Actor:
- Root Admin / System Admin

Goal:
- review high-impact platform operations

Flow:
1. Site admin opens platform audit.
2. Site admin reviews immutable records of system-admin actions.
3. Site admin uses that audit trail for accountability and troubleshooting.

Notes:
- this is a true platform concern
- it is distinct from league-scoped commissioner tools

## Mapping Of Current Admin Surfaces

### Should become Commissioner Tools

These current admin capabilities look primarily league-owned or contest-owned and
should migrate into the commissioner experience:

- admin contest detail and contest operations
  - force close / reopen
  - score override
  - standings recalculation
  - contest re-ingest where it is effectively a league-owned contest correction
- league member/role operations already aligned with commissioner concepts
- future contest-entry correction tools such as add/drop or commissioner fixes

For root admins:

- use the same league-scoped commissioner tools by selecting the target league

### Should remain System Admin Tools

These current admin capabilities look truly platform-scoped:

- providers
  - provider health
  - ingestion dashboard
  - unmapped participants
  - participant mapping
  - provider config
  - re-ingest event/provider operations
- health
  - service health
  - infrastructure metrics
  - errors
  - alerts
- migrations
  - migration runs
  - migration cancellation/detail
- platform config
  - poll intervals
  - ingestion schedules
  - channel config
  - digest config
  - dunning config
  - retention defaults
  - rate limits
  - notification templates
  - push triggers
  - selection/scoring template defaults
- audit
  - platform admin audit trail

### Should be removed or reconsidered with tenant removal

These current admin capabilities are tied to the tenant-first model and need
redesign rather than direct migration:

- tenants index/detail
- tenant plan changes
- tenant suspension/unsuspension
- tenant credits
- tenant exports
- tenant retention overrides

### Should be removed or deferred for now

- flags
- announcements
- support / quick actions

### Should be re-evaluated later

These may remain platform tools, but they need future design clarification:

- global user management
  - user detail
  - disable/enable
  - force logout
  - merge users
  - reset password
  - send email
- impersonation
- billing administration once paid tiers matter

## Implementation Guidance

Agents implementing administration changes should prefer this order:

1. move league-owned operations into commissioner-capable league-scoped APIs
2. let root admins reuse commissioner paths via super-commissioner authorization
3. keep only true platform operations in system-admin tools
4. remove speculative site-admin capabilities that do not support current operational needs
5. remove tenant-scoped admin assumptions as the tenant model is removed
