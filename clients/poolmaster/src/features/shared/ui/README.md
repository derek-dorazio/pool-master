# PoolMaster Shared UI

The shared UI layer is split into three levels:

1. **Primitives** own a single reusable control or visual pattern, such as
   `Button`, `Tile`, `Modal`, `DataGrid`, `ActionTile`, `StatusBadge` and
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
   `layout="row"`, and a dropdown entry is a `MenuItem`; never hand-type
   `normal-case tracking-normal` onto a button. A loading, empty or error state
   is `LoadingState`, `EmptyState` or `ErrorState` (`size="inline"` for one line
   inside a card), a one-line failure beside what failed is an `InlineError`, and
   a query's loading, error, empty and data branches are one `QueryState`; never
   hand-type a `text-destructive` or "Loading..." paragraph.
2. **Templates** compose primitives into repeated page or modal workflows, such
   as `ManagementListPage`, `EntityDetailPage`, `FormModal`, and
   `ConfirmationModal`.
3. **Feature pages** own product-specific data fetching, mutations, copy, and
   business rules. They should compose primitives and templates instead of
   repeating page chrome or modal footers.

## Where a Reusable Piece Lives

- A **generic** piece, one that knows nothing about the product (a heading, a
  row button, a table, an inline state), goes in `features/shared/ui`.
- A **product** piece stays in the feature folder that owns its concept, such
  as `features/teams` (a team name), `features/contests` (a leaderboard or a
  contest row), `features/event-pages` or `features/auth`. Other features import
  it from there rather than copying it or moving it into the shared layer.

## Page Templates

Use page templates when a page matches an existing workflow shape:

- `ManagementListPage` for admin list screens backed by `DataGrid`.
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
`AdminAreaLayout`, `IdentityHeading`, `SettingsSection` / `SettingsRow`
(`SettingsSectionHeader` alone titles a section whose body is a `DataGrid`),
`DangerZone` / `DangerZoneAction`, and `FormPage` for a full-page edit
(with `IconPalette` when the form picks an icon).

A titled card is a `PanelCard`: its title in a ruled bar, with an optional
slot on the right such as a badge or a clear button, then its body and an
optional footer link under a rule. Its body is unpadded for a `PanelList` of
divided rows, and `padded` gives prose, forms or metric grids the card's own
padding. Don't hand-build a heading inside a `Tile` for this.

A team's icon and name come from `features/teams`, not this folder, because they
are a product piece: `TeamAvatar` draws the icon in its coloured square, and
`TeamName` puts it beside the name, linked or plain, with the Yours and Inactive
markers and an optional line underneath.

Public and landing pages share four more pieces. `NumberedSteps` shows steps in tiles under one
gold numeral style, with an optional picture. `FaqList` shows questions that open to their
answers. `ExpandableTile` is a tile whose face opens it across its grid row. `Countdown` shows
days, hours and minutes as one timer. The event page kit (`StartButton`, `LandingSection`,
`PhotoHero`, `StickyActionBar`, `NextUpCard`, `LandingDisclaimer`) is a product piece, so it
lives in `features/event-pages/components`.

`InfoPopover` keeps secondary facts out of a page's way: an icon button whose
callout opens on mouse hover or on a tap, for a phone.

Feature pages should keep route-specific copy and generated-SDK calls local, but
they should not duplicate header, grid-shell, detail/actions, or
public-join layout code when a template fits.

## Modal Templates

Use modal templates when the modal follows one of the common workflows:

- `FormModal` for edit/create forms.
- `ConfirmationModal` for destructive or lifecycle confirmations, including
  exact-match confirmation inputs.
- `PickerModal` for selecting an item from a constrained list.
- `ReadOnlyDetailModal` for payloads and operational metadata.

Modals should use the templates for predictable footer ordering, pending state,
scroll behavior, and error placement. Add a new template only when a workflow
shape repeats across multiple features or materially improves accessibility.

## Mutation Feedback

Use `useMutationActionWorkflow` with `MutationActionToast` for repeated
action-tile and modal mutation workflows. The hook centralizes pending state,
success and error feedback, query invalidation, modal close behavior, optional
navigation, and lifecycle logging so pages do not each re-create the same
mutation ceremony.

Use inline `Alert`, `ServerErrorBar`, or `FormModal` errors for blocking form
validation that the user must fix before submitting. Use mutation action toasts
for completed create, update, lifecycle, copy, invite, and delete outcomes where
the page can keep the user oriented after the mutation finishes. Avoid raw
`alert()` calls or page-local toast wiring when the workflow fits the shared
mutation action pattern.

## Theme Rules

Feature code should use semantic shared components and theme tokens. Avoid raw
scale colors in feature code. Visual treatments belong in the shared primitive
or template that owns the pattern, not in every page that consumes it.
