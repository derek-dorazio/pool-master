# Module Overview

## 1. Event And Feed Operations

PoolMaster ingests real-world events and participant fields from sports-data
providers, normalizes them, and resolves operational timing such as
`releaseAt` and `fieldLocksAt` from seeded relative rules. This module is
designed to run automatically; root-admin tools exist mainly for monitoring and
exception handling.

## 2. Contest Creation And Configuration

Commissioners create contests from seeded templates that provide names,
descriptions, and configuration defaults. The common path should require very
little manual input. Advanced configuration exists, but only as an intentional
override path.

## 3. Team Entry And Selection

Teams create one or more entries for contests and make selections from the
contest's frozen field interpretation. This is the primary member-facing play
surface. Commissioners use these same tools for their own teams and may act in
league context for other teams when needed.

## 4. Live Scoring And Leaderboards

Backend jobs poll providers for live event updates, refresh participant facts,
recompute entry scores, and reorder leaderboards automatically. Normal users do
not operate this flow manually.

Leaderboards and participant drill-down are universal contest concepts across
sports, even though the exact visible data columns and details will vary by
sport.

## 5. League And Membership Operations

Leagues manage membership, invitations, team ownership, co-ownership, and
general social play structure. These are the main recurring commissioner
administrative tasks outside of initial contest creation.

## 6. League Contest History

League history should first focus on completed contests grouped or filterable
by sport and contest type. Members should be able to browse prior completed
tournaments within the league.

## 7. Mock Provider Infrastructure

The mock sports-data provider is real QA/non-production infrastructure that
allows the product to function end to end before real provider coverage is
complete. It should mirror provider-style contracts without becoming production
fallback behavior.
