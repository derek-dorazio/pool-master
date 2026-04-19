# Plans Overview

> Active plans live directly under `plans/`.
> Deferred future-scope plans live under `plans/deferred/`.

## How To Use This Folder

- Treat files in `plans/` as the current execution and replanning surface.
- Plans are execution-oriented only:
  - progress
  - scope
  - sequencing
  - execution notes
  - task tables
- Plans should not act as the product source of truth or technical source of
  truth.
- Product behavior belongs in `requirements/`.
- Technical design belongs in `tech-specs/`.
- Treat files in `plans/deferred/` as future enhancement planning, not current delivery scope.

## Current Intent

The active planning set is being narrowed toward a reviewable MVP:

- leagues and invitations
- contest creation and participation
- draft-once tournament-style contests
- scoring, standings, and results
- minimal history, social, and billing surfaces
- no mobile apps until the web app and service layers are mature enough to review end to end

If an older plan no longer exists on disk, treat git history as the historical record and replan from the current product direction before reviving the work.
