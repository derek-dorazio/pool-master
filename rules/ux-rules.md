# PoolMaster — UX Rules

These rules guide first-draft UX decisions for the PoolMaster web app.

They exist so frontend implementation uses standard, conventional UX patterns by
default instead of improvising layout, control hierarchy, state communication,
or status treatments slice by slice.

This file should evolve as PoolMaster-specific product decisions are reviewed
and refined.

## Source Bias

PoolMaster should prioritize consumer-product UX conventions over enterprise
business-app defaults.

Reference influences for these rules:

- shadcn/ui composition patterns
- Radix primitives interaction and accessibility conventions
- Material UI / Material Design control hierarchy and state conventions

Use those conventions as the starting point, but bias toward a consumer app:

- identity-rich surfaces
- clear empty states
- lighter, more welcoming navigation
- less dense enterprise-style controls
- cards, sections, and guided flows before admin-style tables where possible

## 1. Default UX Behavior For First Drafts

- Use standard web UX conventions unless an active plan says otherwise.
- UX proposals must be grounded in current product truth before they are
  grounded in visual precedent.
- Do not treat archived screens, old wireframes, or broad API capability as
  proof that a field or control belongs in the current feature.
- Prefer familiar layout, button placement, navigation, and state treatments
  over clever or novel interaction patterns.
- When product intent is clear but micro-UX details are not, choose the most
  conventional first draft and surface the assumption in the implementation
  summary.
- Ask follow-up questions only when the UX choice would materially affect
  architecture, data model, or the user journey.

## 2. Action Hierarchy

- Each surface should have one clear primary action.
- Secondary actions should be visually quieter than the primary action.
- Destructive actions must be visually distinct from ordinary secondary actions.
- Follow a conventional hierarchy similar to Material-style button treatment:
  - primary action = strongest emphasis
  - secondary supporting action = outline/subtle emphasis
  - tertiary action = text-style or quiet action
- Button labels should use clear verbs:
  - `Create league`
  - `Join league`
  - `Log out`
- Avoid ambiguous labels like:
  - `Continue`
  - `Submit`
  - `Save changes`
  unless the surrounding context makes the action completely obvious.

## 3. Placement And Layout Conventions

- Keep header controls concise and scannable.
- Compact header controls should prioritize identity first:
  - league avatar/icon
  - league name
- Menus should contain quick actions or quick switching, not miniature pages.
- Dialogs should stay focused on a single task with clear primary and secondary
  actions.
- Do not overload compact selector rows with extra icons or multiple competing
  status indicators when space is tight.
- In constrained navigation components, use subtle visual treatment for status:
  - muted tone
  - background shading
  - text treatment
  - small status copy only when space allows
- Richer status presentation belongs on larger surfaces such as:
  - grid cards
  - list tiles
  - settings/manage pages
  - full league detail/home panels
- Prefer card/list/tile layouts for consumer league browsing before reaching
  for tables. A list that can run to hundreds of rows (teams, owners, standings)
  is the exception: §12 rule 7.

## 4. Active And Inactive State Rules

- Distinguish clearly between:
  - inaccessible
  - inactive
  - empty
  - loading
  - error
- If an entity still exists and the user can access it, prefer rendering the
  real page in read-only mode over redirecting to a different page.
- Inactive state should be communicated first at the page level:
  - banner
  - status panel
  - disabled action explanation
- Do not rely on disabled controls alone to communicate inactive state.
- Do not rely on color alone to communicate active/inactive state.
- When controls are disabled, provide nearby explanatory text so the page does
  not feel broken.

## 5. Menus, Selectors, And Navigation

- Dropdowns and selectors should optimize for fast recognition and low visual
  noise.
- Compact selector rows should generally show only the minimum identity data:
  - icon/avatar
  - name
- Follow Radix/shadcn menu conventions:
  - grouped actions when categories differ
  - separators when action meaning changes
  - submenus only when clearly necessary
- If a status marker is needed in a compact selector, prefer subtle row-level
  treatment over adding another icon unless the reviewed design explicitly
  chooses otherwise.
- Navigation items should remain stable across states when possible; avoid
  moving controls around between active and inactive pages unless the page model
  truly changes.

## 6. Page-Level State Communication

- Use a page-level message when a whole surface is inactive or read-only.
- Use inline helper text when only one section or action group is affected.
- Preserve the main structure of the page when the page is still meaningful in
  read-only mode.
- Read-only state should preserve understanding first, then explain why actions
  are unavailable.
- Error states should explain recovery actions:
  - return to welcome
  - use league selector
  - retry

## 7. Forms And Validation

- Show validation close to the field that needs attention.
- Prefer inline validation and clear helper text over vague banner-only errors.
- Pending states must be visible:
  - disabled submit
  - loading text
  - spinner only when it adds value
- Preserve consistent button ordering within the same modal or form pattern.
- For modal tasks, keep the primary action in the predictable confirmation
  position and keep cancellation visually quieter.

## 8. Accessibility Expectations

- Do not rely on color alone to signal status or interactivity.
- Keep semantic controls and keyboard accessibility intact.
- Icon-only actions require an accessible name.
- Disabled or read-only states should still remain understandable to assistive
  technology users through visible copy and control semantics.

## 9. PoolMaster-Specific UX Guidance So Far

- The header league switcher is the only way to move between leagues — there
  is no separate "My Leagues" grid/list page. Keep the switcher compact:
  - league avatar/icon
  - league name
- If commissioner-visible inactive leagues need special treatment in the
  compact selector, start with subtle row styling rather than another status
  icon.
- Richer per-league status (active/inactive indicator, counts) belongs on
  **League Home** (`/league/:leagueCode`), the league's landing page; the
  league's settings and lifecycle actions belong in Commissioner tools. See §12
  and `requirements/product-requirements/navigation-and-entry-points.md`.
- Member inactive-league experience should emphasize, on League Home itself:
  - same league home
  - read-only state
  - clear explanation
  - `Message commissioner` as the future-oriented next step

## 10. Frontend Persona Requirement

Apply these rules by default when preparing the first implementation draft.

That means:

- make conventional UX choices proactively
- explain important UX assumptions after implementation
- suggest best-practice options when a design detail is still open
- avoid punting ordinary layout and control decisions back to the user unless
  the tradeoff is genuinely product-shaping

For product-manager and UX-design work before implementation:

- verify the active domain/contract inputs first
- prefer current source-of-truth fields over archived design precedent
- if a design review uncovers a stale contract or model signal, surface it as a
  cleanup issue instead of normalizing it into the proposed UX

## 11. What To Avoid By Default

Unless a reviewed product requirement calls for it, avoid these enterprise-leaning
defaults in first drafts:

- dense admin tables as the first representation of consumer-facing content
- icon overload in compact navigation surfaces
- multiple competing primary actions in one panel
- status communicated only through tiny badges with no surrounding explanation
- hiding useful read-only information just because editing is unavailable

## 12. League Pages and Commissioner Tools

Every league-scoped page follows these rules, and so does any later
administration area (root admin included), reusing the same shared components.

1. **Two areas.** The member area is what everyone in a league uses.
   Commissioner tools is a separate area that only commissioners, and root
   admins looking at the league, can open. No commissioner-only control appears
   in the member area: a commissioner acts as a member most of the time.
2. **One league menu.** Member pages share one menu under the app bar (Home,
   Contests, My team, Teams; `LeagueMenu`). Commissioners also see a
   Commissioner tools button at its right end. The league selector stays in the
   app bar. An administration area has its own header with a way back and a side
   menu (`AdminAreaLayout`) instead of the league menu. Each of its pages has one
   heading: the area titles the page, or an entity's landing page shows its
   `IdentityHeading`. A page never adds a second header or "Back to" link of its
   own; the trail leads back up.
3. **Compact identity, once.** An entity's icon, name and shareable code appear
   once, as a compact heading (`IdentityHeading`) on its landing page. No page
   repeats them as an editable detail panel.
4. **Full pages, not dialogs.** Editing and managing are full pages with their
   own route, so Back and links work (`FormPage`). Dialogs are only for
   confirming a destructive or irreversible action: inactivate, delete, leave,
   remove.
5. **One edit for all properties.** An entity's editable properties are edited
   together on one form page with one Save, never a dialog per property.
6. **Danger zone.** Destructive actions sit in their own marked section at the
   bottom of the settings page (`DangerZone`), each with a confirm step, never
   beside everyday actions. Settings themselves are shown as labelled rows
   (`SettingsSection`, `SettingsRow`) with one Edit for the group.
7. **Lists scale.** Team, owner and leaderboard lists have search and paging,
   assuming hundreds of rows: tables through `DataGrid`, other lists through
   the same `Pager`. A long ranked list also offers a way to jump to the
   viewer's own row. Summary cards show a few rows and link to the full page.
8. **Summary first.** A landing page leads with what needs the member now (the
   next contest to enter, with its cutoff), then live standings, then their own
   team.
9. **One header per entity's pages.** Pages that show one entity from
   different angles share one header and a segmented sub-menu between them,
   not "Back to" and "View" links on each page. A contest's pages share
   `ContestHeader`: Entries, Leaderboard once picks are revealed, and My entry
   once the viewer's team has one. A golf tournament's pages in Manage share
   `GolfTournamentHeader`: Overview, Field, Tiers and Scores.
10. **Actions are named for what they do, never "draft".** "Draft" is a contest
    status and also the snake-draft selection type, so no button or link uses
    it as a verb or noun: **Create contest**, **Save**, **Delete contest**,
    **Open to league**, **Finish setup**. The status label itself stays as
    `contestStatusLabel` gives it. A list row has one action naming the next
    step (Finish setup before a contest opens, Manage after).
11. **Formats and tiers in plain words.** A contest's format is its name
    ("Tiered", from `formatSelectionTypeName`) and its rules one sentence
    (`formatContestRules`), never raw enums such as `TIERED · STROKE_PLAY`. An
    event's tiers read **Tier 1**, **Tier 2**, … from `tierNumber`, one per
    row with Tier 1 on top.
