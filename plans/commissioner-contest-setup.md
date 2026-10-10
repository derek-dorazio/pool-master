# Commissioner tools: contests and invites

Tickets: #572 (contests list, contest page, edit), #573 (create contest),
#574 (invites page).

Planned 2026-10-10 against main `f93ffa7`. Agreed design: https://claude.ai/artifact/KthSRPDgXDUXcASXr8MgwX
(Derek chose the one-page create, "concept A", on 2026-10-10). Use its screens as the visual
reference; colours and fonts in it come from the app.

Follows `rules/ux-rules.md` §12 *League Pages and Commissioner Tools*, which #557 established.
Frontend only: no API, DTO or schema change (see *Data*).

## Why

#557 moved contest setup into Commissioner tools but kept its old pages. League settings, Teams,
Manage team and Edit team already follow §12; these do not:

- **Contests** (`manage-contests-page.tsx`): two tiles of cards, no search or paging (a league
  runs a contest most weeks, so history reaches hundreds), raw enums as metadata
  ("TIERED · GOLF_STROKE · GOLF"), two buttons per row.
- **Create / manage contest** (`create-contest-page.tsx`, ~1,000 lines): one form serves create,
  edit and the locked view (a disabled fieldset). Two side panels ("Current choices",
  "Lifecycle truth") repeat the form. The event dropdown is followed by a readiness panel for an
  event that is ready by definition. Delete sits beside Save and Open to league. Saving an edit
  jumps to the member contest page.
- **Member contest page** shows commissioner controls (Open to league, Manage contest) on a
  contest that is not open yet, against §12 rule 1.
- **Invites**: the invite form and join link live in a dialog (§12 rule 4); pending invites are
  card rows with no search or paging.

## Wording (Derek 2026-10-10)

"Draft" is a status and also the snake draft type, so it is never an action. Buttons say
**Create contest**, **Save**, **Delete contest**, **Open to league**. Remove "Save draft
changes" and similar. The status label for a contest that is not open stays as it is today
(`contestStatusLabel`). Add this to `rules/ux-rules.md` §12 as a wording rule.

Tiers are named **Tier 1**, **Tier 2**, … from `tierNumber`, listed top tier first, one per row
(Derek 2026-10-10).

## Pages

All under the existing `CommissionerToolsLayout` and `/league/:code/admin` guard.

| Page | Route | Content |
|---|---|---|
| Contests | `/admin/contests` | Page header with Create contest. Search ("Find a contest or event"), Active / History switch (`isHistoricalContest`), `DataGrid` with 25 per page. Columns: contest (name, format name under it), status chip, event (name, start), entries (count; "of N teams" while open), one action: **Finish setup** before opening, **Manage** after. Contests not yet open sort first, then by event start. |
| Contest | `/admin/contests/:id` | Identity heading (name, status chip, event and start). **Status card** first: not open → readiness checks (event released, golfers and tiers loaded, event not started) and **Open to league** (keeps its confirm dialog) plus "Preview as a member"; open → entries, teams still to enter, time to close; live → link to the leaderboard; final → link to results. **Contest** settings section: Name, Event (fixed), Format (fixed), Rules sentence, Entries per team; one **Edit** while not open, a "Locked" note after. **Tiers** section (tiered only): one row per tier, Tier 1 first, golfer count. **Danger zone** with Delete contest while not open; absent after. |
| Edit contest | `/admin/contests/:id/edit` | `FormPage`: name, rules fields, entries per team; event and format read-only. Save returns to the contest page. Reached only while not open (page redirects to the contest page otherwise). |
| Create contest | `/admin/contests/new` | `FormPage`, one card, four numbered sections: **1 Event** (radio list of contest-eligible events, soonest first: name, venue, start, golfers, tiers, "in N days"), **2 Format** (one card per selection type, Tiered only for now; template presets as "Start from" chips, the default preselected, plus Custom), **3 Rules** (fields for the chosen format; entries per team with No limit), **4 Name** (prefilled from event and preset until edited) and a "Members will see" rules sentence. Footer: Cancel, Create contest. Lands on the new contest's page. Empty state when no event is eligible keeps today's copy. |
| Invites | `/admin/invites` | **Invite people** section: invite by email (one address, Send invite) and the join link (create/refresh, copy). **Waiting on an answer**: search, Pending / Expired switch, `DataGrid` table (email or "Join link", sent by and date, expires, copy / Resend / Cancel). |

Member side: the contest page drops Open to league and Manage contest. Its summary line uses
the same rules sentence instead of `selectionType · scoringEngine · sport`.

## Shared pieces

- `formatContestRules(selectionType, configuration, tierCount)`: one plain sentence ("Pick 1
  golfer from each of 6 tiers. The best 4 scores count.") and `formatSelectionTypeName`
  ("Tiered"). Used by the contest page, create preview and the member contest header. Keyed by
  selection type so #93 adds a budget arm.
- `ContestStatusCard`: one component per status branch, so the contest page stays small.
- Reuse `FormPage`, `SettingsSection`/`SettingsRow`, `DangerZone`, `IdentityHeading`,
  `DataGrid` (search + pager), `SegmentedControl`, `ConfirmDialog`. No new table or form shell.
- Split `create-contest-page.tsx`: create page, edit page, and a shared `ContestRulesFields`
  (the per-format rules inputs) so #93 slice 3 adds a budget arm in one place.

## Data

No backend change.
- Contest list: `ContestDto` (status, selectionType, entryCount, sportEventId). Event name and
  start come from the shared event cache (`QueryKeys.sportEvents.detail`, as
  `use-contest-schedule.ts` does), fetched for the rows on the visible page only. Team count
  from `useLeagueSquadsQuery`.
- The list shows the format name, not the full rules: `ContestDto` has no configuration, and
  adding it is not worth a contract change. The rules sentence is on the contest page, from
  `getContestConfiguration`.
- Readiness checks: the event's `readinessStatus`, `loadedParticipantCount`, `tierCount`.
- Invites: existing invitations query and mutations; search, filter and paging client-side.

If implementation finds a real gap, stop and escalate rather than adding an endpoint.

Found in #572: the configuration read is commissioner-only, so the member contest header cannot
show the rules sentence without a contract change. It shows the format name ("Tiered") instead
of the raw enums.

## Budget (#93)

Slice 3 of `plans/93-budget-selection.md` adds a **Budget** format card to section 2 of Create
contest, a budget arm to `ContestRulesFields` (golfers per entry, scores that count, salary cap
read-only from the event's pricing) and to `formatContestRules`. The contest page needs nothing
else. These tickets build the slots; they do not add budget.

## Delivery

Three PRs, each against `main` as soon as its gates pass:

1. **#572**: Contests table, contest page with status card / settings / tiers /
   danger zone, Edit contest page, member contest page loses commissioner controls, rules
   formatter, wording rule in `rules/ux-rules.md` §12. `create-contest-page.tsx` loses its edit
   and locked modes (create unchanged otherwise).
2. **#573**: Create contest rebuilt as above, `ContestRulesFields`, side panels and
   `EventReadinessPanel`, `ContestSetupSummary`, `InheritedTiersPanel` deleted. Starts after 1
   merges (same file).
3. **#574**: Invites page. Independent; can run beside 1.

Dead code (project goal): delete whatever the new pages leave without a caller, including the
old `ListCard` rows, `contest-configuration-sections.tsx` pieces, and the invite `ActionModal`.

Each PR updates the README or feature docs it affects (`rules/workflow-rules.md` §6).

## Tests

`rules/testing-rules.md` §1A–§1C. Component tests move with the pages; where one asserts the old
layout, rewrite it to assert the same behaviour. Add: contests search, History switch and paging;
contest page per status (Edit and Delete only before opening; Open to league confirm; no
commissioner controls on the member contest page); edit page redirects once open; create
preselects the soonest event and default preset, prefills the name until edited, lands on the
new contest; invites search and Pending / Expired. Browser specs that create a contest or invite
members update to the new labels and routes.
