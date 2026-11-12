# PoolMaster Shared UI

The shared UI layer is split into three levels:

1. **Primitives** own a single reusable control or visual pattern, such as
   `Button`, `Tile`, `Modal`, `DataGrid`, `Switch`, `StatusBadge` and
   `Eyebrow`. A bordered card box is a `Tile` (`padding="none"` plus your own
   padding when it needs less), and the small uppercase line over a title is an
   `Eyebrow`; a navy panel is a `Tile` with `variant="inverse"` (or
   `"inverseDeep"`), and the gold pill is a `Chip` with `tone="brand"` (a tinted one
   is `tone="brandTint"`, a not-yet one `tone="placeholder"`, and `asChild` puts it on a
   `Link`); the outlined uppercase tagline pill is a `StatusBadge` with
   `tone="brandOutline"`, not a `Chip`, which is sentence case; a title is a `Heading` (`level` is the tag, `variant` the look:
   `hero`, `display`, `page`, `section`, `subtitle`, `label`, `eyebrow`, or `card` with a `size`); letter spacing comes from the theme's `tracking-eyebrow` and
   `tracking-label`, never a hand-typed `tracking-[…]`. A button drawn as a line of content
   (a list row, a card toggle, a pick) is a `Button` or `LinkButton` with
   `layout="row"`, and a menu that opens from a button is a `DropdownMenu` built
   from its parts (`DropdownMenuItem` rows, `isSelected` for the current one); never hand-type
   `normal-case tracking-normal` onto a button. A loading, empty or error state
   is `LoadingState`, `EmptyState` or `ErrorState`: a card of its own by default,
   `size="inline"` for one line inside a card, `size="plain"` inside a body that is
   already padded; a list's `LoadingState` (or `QueryState`) takes `rows` for faint
   placeholder rows. A query's loading, error, empty and data branches are one
   `QueryState`, whose error offers Retry from the query's own `refetch`; a
   hand-drawn `ErrorState` takes `onRetry` (`refetchFailed(...)` when it waits on
   several reads, `null` for a failure reading again cannot fix, such as no access). A one-line failure beside what failed, such as a refused save, is
   an `InlineError`. Never hand-type a `text-destructive` or "Loading..." paragraph;
   `poolmaster/no-hand-written-query-states` fails one in feature code. A small table is a
   `SimpleTable` built from its parts (`density="compact"` inside a card,
   `surface="inverse"` on a navy panel, `isHighlighted` for the viewer's row,
   `numeric` for figures); an upload preview is an `UploadPreviewTable`; a
   table that needs search or sorting is a `DataGrid`. Labels beside their values are a
   `FactList` (`layout="inline"` by default; `"inset"` under a row that opened
   it; `"columns"` for a few facts side by side, stacking on a phone;
   `density="compact"` in a popover or peek card), never a hand-built `<dl>`;
   a page's headline numbers are a `MetricGrid` instead, and rows with columns
   of their own a `SimpleTable`. Requirements met or not are a `CheckList`
   (missing first, `surface="inverse"` on a navy panel); a fixed run of stages is a
   `StageTrack` (`surface="inverse"` on a navy panel). Copy to clipboard is a
   `CopyButton` (`iconOnly` in a tight spot), which says Copied, shows an inline
   error when the browser refuses and logs it; feature code never calls
   `navigator.clipboard` itself. A password box is a `PasswordInput`,
   which carries its own Show password eye button; never hand-type
   `type="password"` on an `Input`.
2. **Templates** compose primitives into repeated page or modal workflows, such
   as `EntityDetailPage`, `FormModal`, and
   `ConfirmDialog`.
3. **Feature pages** own product-specific data fetching, mutations, copy, and
   business rules. They should compose primitives and templates instead of
   repeating page chrome or modal footers.

## Formatting Values

A value written on screen goes through `format.ts`, exported from the index:
`formatPlace` / `formatOrdinal` ("T2", "1st"), `formatNumber`, `formatCount`
("1,000 entries"), `formatCupPoints`, `formatMoneyCents` and `formatNumberList`,
plus the date formatters from `date-time-format.ts`. `DateDisplay` draws a date in the
body colour; `tone="inherit"` takes the colour of the line around it, such as a row's
muted fact line, so pages never pass it a colour class. Numbers take the viewer's
locale from `useDisplayPreferences().locale`, so pass it in rather than fixing
`en-US`. Feature code never calls `toLocaleString`, `toFixed` or `new Intl.*Format`
itself; `poolmaster/no-inline-display-format` enforces it
(`rules/react-ui-rules.md` §5 *Environment And Time Discipline*).

## Where a Reusable Piece Lives

- A **generic** piece, one that knows nothing about the product (a heading, a
  row button, a table, an inline state), goes in `features/shared/ui`.
- A **product** piece stays in the feature folder that owns its concept, such
  as `features/teams` (a team name), `features/contests` (a leaderboard or a
  contest row), `features/event-pages` or `features/auth`. Other features import
  it from there rather than copying it or moving it into the shared layer.

## Page Templates

Use page templates when a page matches an existing workflow shape:

- An admin list is no template: a `PageHeader` (with the search box, or one
  action and the grid's own search), then `DataGrid`, with `QueryState` for its
  loading and error states.
- `StatusPage` for a page that is only a status: not found, a crash, a dead or
  expired link, or the done or confirm step after a link from an email. A
  symbol (`kind`), a title, one plain line and one primary action, centred in
  the 8px card; a failed try's `Notice` goes in as children above the action.
- `EntityDetailPage` for profile/entity details with a summary above, details
  on the left and less frequent actions on the right.
- `FormEditorSection` for repeated editable configuration sections with
  consistent title, errors, and footer actions.
- `PublicInviteJoinPage` for public invitation or join surfaces.

`DataGrid` takes an optional `search` (one box matching every text column),
`pageSize` (rows per page, with a Previous/Next pager once there is more than
one page) and `showColumnFilters` (on by default). A list that can grow to
hundreds of rows uses `search` and `pageSize` (`rules/ux-rules.md` §12). A list
that is not a table pages through `Pager`, the same Previous/Next control.

League pages and administration areas use the pieces named in
`rules/ux-rules.md` §12 *League Pages and Commissioner Tools*: `LeagueMenu`,
`ToolsArea`, `PageHeader`, a `SettingsSection` of `SettingsRow`s for
settings, "see it, then Edit": label left and value right, one Edit in the title
opening the group's `FormModal`, and a `Switch` in a row for a setting that saves
the moment it is flipped (pages not yet moved over use a `SectionCard` of
`SettingsRows`; a `bare` `SectionCard` titles a section whose body
is a `DataGrid`), a `SectionCard` with `tone="danger"` of `DangerZoneAction`s
for a danger zone, and `FormPage` for a full-page edit
(with `IconPalette` when the form picks an icon). A `FormPage` saved by one
mutation takes its submit, pending state and error from `formPageSave` in
`@/lib/form-page-save`. A root admin settings group's form is built on
`useSettingsGroupForm` and `SettingsSaveError` in `features/root-admin`, which
send the version the draft came from and offer the newer one on a conflict.
`ConfirmDialog` and `FormModal` share one footer, `DialogActions`. Feature code
never opens the raw `Modal`: every dialog is one of the four types under
*Modal Templates*.

Commissioner tools and Manage frame their pages with `ToolsArea`: a slim navy
band naming the area, what it acts on and the way back, then the tools as one
row of link `PageTabs`, with an optional `subTabs` second row for the open
tool's own choices (Manage's sports). A `FormPage` opens with its own
`PageHeader`.

Every page starts with one `PageHeader`: an optional `breadcrumbs` line, its title
straight on the page (never in a card) with an optional `titleAside` such as a
`HelpTip`, an optional `icon` or `avatar`, an optional `meta` fact line ("12 members
· 2 active contests"), and a right slot: `actions` for at most two small
buttons, or `search` for the page's search box, which takes a full-width line on a
phone. The `status` slot holds one compact chip, a status, count or summary
(a contest's Live or Final, "12 entries"), at the far right of the header's first
line: beside the breadcrumb, or at the end of the title row after any actions. It
stays on the first line on a phone. A `description` is only for a rule the reader needs or
the entity's own words, never a sentence saying what the page is. A page's views
are `PageTabs` in the header's `tabs` slot — `variant="link"` for views with
their own address, `variant="state"` inside the page's own `Tabs` root — and a
filter that changes every tab or the whole page, such as a season or a sport, is a
`FilterPicker` in `tabsEnd` (with no tabs it has the bottom line to itself). On a phone
`PageTabs` and `LeagueMenu` scroll sideways through `useScrollRow`: the selected
tab is scrolled fully into view on open and whenever it changes, and an edge fades
only while more tabs sit beyond it. A page that reads one year at a time picks it
with `YearPicker`, the `FilterPicker` labelled "Season": in `tabsEnd` on a page with
tabs, else at the end of its section's title row. A
`SegmentedControl` is only for choosing a value inside a form or panel, never for
switching a page's views. A search box in the header feeds a `DataGrid` through
its `searchTerm`.

Text that is not a title (`Heading`) or the line over one (`Eyebrow`) is a `Text`:
`variant` is `body`, `meta`, `caption`, `label`, `value`, `strong` or `numeral` (a big
place figure in the display face, in the colour of what it sits on, such as a podium step), `tone`, `weight` and `size`
are optional (`size="inherit"` for a name inside a larger line), `truncate` cuts a long line,
`as` picks `span` (the default), `p` or `div`, and `asChild` styles a `Link` in place.
The header's brand type is a `Text` too: `wordmark`, `nav` (its links), `displayLabel`
(the "League" caption) and `display` (the league name), with the dark band's tones
`onInverse` and `onInverseLabel`; `hoverTone` sets a link's hover colour. An icon
is an `Icon` (`icon={Award} tone="muted"`), hidden from screen readers. Pages never
type font size, weight, case or text colour classes (`rules/react-ui-rules.md` §5 *Theme And
Styling Discipline*).

A section of a page is a `SectionCard` (`rules/ux-rules.md` §12 item 13): its
`SectionTitle` in a ruled bar (house uppercase italic, an optional `help` (?)
`HelpTip` that holds how the section works, and an optional `trailing` slot for one
badge, count or filter), then its body, then an optional footer link
(`SectionFooterLink`, blue small caps with an arrow). The body is unpadded for
`SectionRows` of `SectionRow`s (a name, a muted fact line and note, one figure
as `value`, one badge or action as `aside`; `to` makes the whole row a link, and
`control` puts a checkbox at its start with the whole row as its label, and
`picture` a small 16:10 drawing at its start) or
a `SectionEmpty` italic line; `padded` gives forms, charts or metric grids the
card's padding (`SectionBody` is that padded block on its own, beside rows, and
`SectionNote` a muted line about the data inside it). `bare` keeps the title and rule without the box, and
`tone="danger"` is a danger zone. A section the league's plan leaves out is a
`LockedSection`: the same title in the same place, a lock, one line naming the plan
that includes it, and a "See plans" footer link. The parts own their type and colours: pass
content, never text classes, and add a variant here for a new look. Don't
hand-build a heading inside a `Tile`. A section inside another section's padded
body titles itself one level down (`headingLevel={4}` under a level 3). Data is
never a raw `ul`/`li`: rows are `SectionRow`s, and a list that is not rows is a
named composite in its feature folder, such as `FeatureList` in `features/plans`
for a plan's ticked or hidden features (`rules/ux-rules.md` §12 item 13). A box
inside a section (a selected icon, the team you'll co-own) is a `Tile` with
`radius="sm"`, the same 8px corner as `SectionCard` and `Notice`; a page never
types `rounded-2xl`, `rounded-3xl` or `rounded-4xl` itself.

A team's icon and name come from `features/teams`, not this folder, because they
are a product piece: `TeamAvatar` draws the icon in its coloured square, and
`TeamName` puts it beside the name, linked or plain, with the Yours and Inactive
markers and an optional line underneath.

Public and landing pages share four more pieces. `NumberedSteps` shows steps in tiles under one
gold numeral style, with an optional picture. `FaqList` shows questions that open to their
answers. `ExpandableTile` is a tile whose face opens it across its grid row. `Countdown` shows
days, hours and minutes as one timer. `StickyActionBar` is the slim bar a phone keeps at the
bottom while the block it stands in for is out of view: an event page's hero button, or a pick
page's submit section. The event page kit (`StartButton`, `LandingSection`, `PhotoHero`,
`NextUpCard`, `LandingDisclaimer`) is a product piece, so it lives in
`features/event-pages/components`.

Extra information is one of the four more-info pieces, chosen by the question it
answers (`rules/ux-rules.md` §15 *Showing More*): `HelpTip` (?) says how something
works, `DetailsPeek` (i) with its `PeekCard` says who or what one thing is,
`ExpandableRow` opens a row's breakdown on a click, and `Notice` holds what the reader
must know now. `InfoPopover` is their internal base and is not exported.
`DetailsPeek` opens after a short hover delay, so scanning a list does not flash every
row, and mounts its card only when it opens, so a peek that reads data reads it then
(`EntryDetailsPeek` in `features/contests` reads an entry's team and owners this way).

Feature pages should keep route-specific copy and generated-SDK calls local, but
they should not duplicate header, grid-shell, detail/actions, or
public-join layout code when a template fits.

## Modal Templates

Use modal templates when the modal follows one of the common workflows:

- `FormModal` to edit or create something.
- `ConfirmDialog` for yes/no: `tone="danger"` when the action destroys or removes,
  `confirmationInput` for type-to-confirm, and `error` for why the last attempt
  failed (a red `Notice` above the buttons; the dialog stays open).
- `PickerModal` to choose an item from a list.
- `ReadOnlyDetailModal` to look only: payloads and metadata, or (`size="sm"`) a
  sentence on why an action isn't available.

Modals should use the templates for predictable footer ordering, pending state,
scroll behavior, and error placement. Add a new template only when a workflow
shape repeats across multiple features or materially improves accessibility.

## Mutation Feedback

A save that succeeds closes its dialog and confirms with a toast: call
`showToast` (from `toast-store.ts`), or give `useMutationActionWorkflow` a
`successToast`. Both show in the app's one `Toaster`, mounted at the root, so
the toast outlives the dialog it closed or the page it left. Use
`useMutationActionWorkflow` for repeated action-tile and modal mutation workflows. The hook centralizes pending state,
success and error feedback, query invalidation, modal close behavior, optional
navigation, and lifecycle logging so pages do not each re-create the same
mutation ceremony.

Use inline `Notice`, `ServerErrorBar`, or `FormModal` errors for blocking form
validation that the user must fix before submitting. Use mutation action toasts
for completed create, update, lifecycle, copy, invite, and delete outcomes where
the page can keep the user oriented after the mutation finishes. Avoid raw
`alert()` calls or page-local toast wiring. Tests that assert a toast render
`<Toaster />` beside the component; the test setup clears toasts after each test.

## Theme Rules

Feature code should use semantic shared components and theme tokens. Avoid raw
scale colors in feature code. Visual treatments belong in the shared primitive
or template that owns the pattern, not in every page that consumes it.
