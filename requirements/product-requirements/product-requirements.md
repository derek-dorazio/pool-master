# Product Requirements

Shared refined product requirements live here when a feature or domain needs a
stable product-level reference outside the execution plans.

Active implementation still tracks status in `plans/`.

## Cross-Feature Product Truth

- PoolMaster is designed to be primarily self-running.
- Real-world events and provider data are upstream truth.
- Root-admin tools are exceptional operational tools, not normal daily product
  steps.
- Commissioners should have minimal recurring duties after contest creation.
- Commissioners are also members and should use the same team and entry tools,
  with broader league-scoped authority when administrative intervention is
  required.
- Live scoring and leaderboard updates are backend automation flows, not normal
  commissioner/member/admin workflows.
- Seeded templates and default timing rules exist specifically to minimize
  friction and manual configuration.
- Leaderboards and participant drill-down are cross-sport contest concepts,
  even though the exact visible detail varies by sport.
- First-pass history should focus on completed contests within a league,
  filterable or grouped by sport and contest type.
- The preferred delivery order is one complete end-to-end contest lifecycle for
  golf before broadening to additional sports.
- Entry-selection UI is contest-type-specific; the first concrete design target
  is tiered golf.
