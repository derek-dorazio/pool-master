# PoolMaster Shared UI: the pattern catalog

This file is the one catalog of the web app's shared pieces: what each one is for, when to use
it, when to reach for something else, and the props that matter. `rules/ux-rules.md` says which
pattern a situation calls for and links here; `rules/react-ui-rules.md` holds the rules that
enforce them. Each entry links to its gallery story, which shows every variant in light and dark
at phone and desktop widths: run `npm run gallery` in `clients/poolmaster`.

The shared layer has three levels:

1. **Primitives** own one control or visual pattern, such as `Button`, `Tile` or `Heading`.
2. **Templates and sections** compose primitives into a repeated shape, such as `PageHeader`,
   `SectionCard`, `FormModal` or `ConfirmDialog`.
3. **Feature pages** own data fetching, mutations, copy and business rules. They compose the
   first two levels and never repeat page chrome, section frames or dialog footers.

**The section is the unit.** A page is a `PageHeader` and a stack of sections, each section in a
file of its own (`rules/react-ui-rules.md` §5 *Page Decomposition Threshold*). A section reads its
own data, owns its states and draws itself from the pieces below, so it is also the unit that
will port to the React Native app: a section rebuilt there keeps its props and its data, and only
its drawing changes.

Pieces are listed under their gallery heading. A product piece, one that knows a product concept,
lives in its feature folder (*Product pieces*, near the end).

## Which piece for which job

| The job | The piece |
|---|---|
| The top of every page | `PageHeader` |
| One part of a page | `SectionCard`, or `LockedSection` when the plan leaves it out |
| Settings: see it, then Edit | `SectionCard` with `edit`, rows with `layout="setting"`, a `FormModal` |
| An edit of up to three simple fields | `FormModal` |
| Anything bigger | `FormPage` with `FormSection`s |
| Yes or no before a destructive action | `ConfirmDialog` |
| How something works | `HelpTip` (?) |
| Who or what one thing is | `DetailsPeek` (i) |
| A row's breakdown | `ExpandableRow` |
| What the reader must know now | `Notice` |
| A save went through | a toast (`showToast` or `useMutationActionWorkflow`) |
| A read is loading, failed or empty | `QueryState` |
| A page that is only a status | `StatusPage` |
| A table with search, sort or paging | `DataGrid` |
| A small table | `SimpleTable` |
| Labels beside values | `FactList` |
| Any text that is not a title | `Text` |
| Any number, date or count on screen | the `format.ts` formatters |

## Page

### `PageHeader`
The one header at the top of a page.
- **Use when:** always, once per page; a `FormPage` brings its own.
- **Don't use when:** you want a title inside a card or a section; that is a `SectionCard` title.
- **Props that matter:** `title` (straight on the page, never in a card); `titleAside` for a
  `HelpTip`; `breadcrumbs`; `icon` or `avatar`; `meta`, one fact line ("12 members · 2 active
  contests"); `actions`, at most two small buttons, or `search`, the page's search box (a
  full-width line on a phone, feeding a `DataGrid` through its `searchTerm`); `status`, one
  compact chip (Live, Final, "12 entries") at the far right of the first line, which stays there
  on a phone; `tabs`, the page's `PageTabs`; `tabsEnd`, a filter that changes every tab, such as
  a `FilterPicker` or `YearPicker`. `description` is only for a rule the reader needs or the
  entity's own words, never a sentence saying what the page is. Title, facts and tabs fit in
  about 100px on a desktop and 120px on a phone. `Breadcrumbs` is exported for a header-like
  line elsewhere.
- **Story:** [page-header.stories.tsx](./page-header.stories.tsx)

### `PendingPage`
Holds the header's place while a page whose header names the thing being read loads or fails.
- **Use when:** the `PageHeader` shows the team, contest or league being read.
- **Don't use when:** the header is fixed text; draw the real header and put `QueryState`
  (`size="tile"`) in the body.
- **Story:** [pending-page.stories.tsx](./pending-page.stories.tsx)

### `SplitContentLayout`
A main column and an aside that stack on a phone.
- **Use when:** a page body has a main column and a narrower companion (a form beside its steps).
- **Props that matter:** `main`, `aside`.
- **Story:** [layout-presets.stories.tsx](./layout-presets.stories.tsx)

### `PublicInviteJoinPage`
The frame of a public invitation or join page.
- **Use when:** someone arrives from an invite link and is asked to join.
- **Story:** [page-templates.stories.tsx](./page-templates.stories.tsx)

### `StatusPage`
A page that is only a status.
- **Use when:** not found, a crash, a dead or expired link, or the done or confirm step after a
  link from an email.
- **Don't use when:** the page has content that failed to load; that is `QueryState`.
- **Props that matter:** `kind` picks the symbol; a title, one plain line and one primary action,
  centred in the 8px card; a failed try's `Notice` goes in as children above the action.
- **Story:** [status-page.stories.tsx](./status-page.stories.tsx)

## Sections

### `SectionCard` and its parts
The one section look: a title bar with a rule, a body, and an optional footer link.
- **Use when:** any part of a page with a title, on any page.
- **Don't use when:** a page's headline numbers stand alone (`MetricGrid`), or the plan leaves
  the section out (`LockedSection`). Never hand-build a heading inside a `Tile`.
- **Props that matter:**
  - `SectionTitle` in the ruled bar: house uppercase italic, `help` for a `HelpTip` holding how
    the section works, `trailing` for one badge, count or filter.
  - `edit` puts one Edit in the title, the settings card's way into its `FormModal`.
  - `padded` gives forms, charts or metric grids the card's padding; `bare` keeps the title and
    rule without the box (a section whose body is a `DataGrid`); `tone="danger"` is a danger zone.
  - The body is `SectionRows` of `SectionRow`s, or one `SectionEmpty` italic line. A
    `SectionRow` has a name, a muted fact line and note, one figure as `value`, and one badge,
    action or `Switch` as `aside`; `to` makes the whole row a link, `control` puts a checkbox at
    its start with the row as its label, `picture` a small 16:10 drawing, and `layout="setting"`
    sets name left and value right.
  - `SectionBody` is the padded block on its own beside rows, `SectionNote` a muted line about
    the data, `SectionStack` divides a section's row lists from a form or notice between them,
    and `SectionFooterLink` is the blue small-caps footer link with an arrow.
  - A section inside another's padded body titles itself one level down (`headingLevel={4}`
    under a level 3).
- **Rules:** data is never a raw `ul`/`li`; rows are `SectionRow`s, and a list that is not rows
  is a named composite in its feature folder (`FeatureList`). The parts own their type and
  colours: pass content, never text classes, and add a variant here for a new look.
- **Story:** [section-card.stories.tsx](./section-card.stories.tsx)

### The settings card ("see it, then Edit")
Not a component of its own: a `SectionCard` with `edit`, `SectionRow`s with `layout="setting"`,
and one Edit in the title opening the group's `FormModal`. A setting that saves the moment it is
flipped is a `Switch` in the row's `aside`. A root admin settings group's form is built on
`useSettingsGroupForm` and `SettingsSaveError` in `features/root-admin`, which send the version
the draft came from and offer the newer one on a conflict.

### `LockedSection`
A section the league's plan doesn't include.
- **Use when:** a commissioner should see what the plan leaves out: same title, same place, a
  lock, one line naming the plan that includes it, and a "See plans" footer link.
- **Don't use when:** never hide the section or show it dead instead.
- **Story:** [locked-section.stories.tsx](./locked-section.stories.tsx)

## Content

### `Text`
Every piece of text that is not a title (`Heading`) or the line over one (`Eyebrow`).
- **Props that matter:** `variant` (`body`, `meta`, `caption`, `label`, `value`, `strong`,
  `numeral` for a big place figure in the display face); `tone`, `weight`, `size`
  (`size="inherit"` for a name inside a larger line); `truncate`; `as` (`span` by default, `p`,
  `div`); `asChild` styles a `Link` in place. The header's brand type is a `Text` too:
  `wordmark`, `nav`, `displayLabel`, `display`, with the dark band's tones `onInverse` and
  `onInverseLabel`; `hoverTone` sets a link's hover colour.
- **Don't:** type font size, weight, case or text colour classes on a page
  (`rules:check:text-styles`).
- **Story:** [text.stories.tsx](./text.stories.tsx)

### `Heading`
The type scale for titles.
- **Props that matter:** `level` is the HTML tag and `variant` the look (`hero`, `display`,
  `page`, `section`, `subtitle`, `label`, `eyebrow`, or `card` with a `size`), so the outline
  stays correct without changing how a title looks.
- **Story:** [heading.stories.tsx](./heading.stories.tsx)

### `Eyebrow`
The small uppercase line over a title: a card's kind, an admin area's name, a menu group.
- **Don't:** hand-type `tracking-[…]`; letter spacing is the theme's `tracking-eyebrow` and
  `tracking-label`.
- **Story:** [eyebrow.stories.tsx](./eyebrow.stories.tsx)

### `Icon`
A decorative icon in one of the theme's text colours, hidden from screen readers.
- **Props that matter:** `icon={Award}`, `tone="muted"`. Name the control around it.
- **Story:** [icon.stories.tsx](./icon.stories.tsx)

### `IconAvatar`
An icon in a rounded square, such as a league's icon.
- **Props that matter:** `size` (`sm`, `md`, `lg`), `tone` (`custom` when the caller's
  `className` brings a team's colours), `selected`.
- **Don't use when:** it is a team; that is `TeamAvatar` in `features/teams`.
- **Story:** [icon-avatar.stories.tsx](./icon-avatar.stories.tsx)

### `Tile`
A bordered box.
- **Use when:** a card that is not a page section: a landing tile, a panel, a frame for a list.
- **Don't use when:** the box has a title; that is a `SectionCard`.
- **Props that matter:** `variant` (`subtle`; `inverse` or `inverseDeep` for a navy panel);
  `padding` (`sm`, or `none` plus your own); `radius="panel"`, the one larger corner, only for
  the panels `rules/ux-rules.md` §12 item 13 names (`poolmaster/no-panel-corner`). A page never
  types `rounded-2xl`, `rounded-3xl` or `rounded-4xl`.
- **Story:** [tile.stories.tsx](./tile.stories.tsx)

### `StatusBadge` and `Chip`
Small pills.
- **Use when:** `Chip` for a sentence-case pill: `tone="brand"` is the gold one,
  `tone="brandTint"` something open or on offer, `tone="placeholder"` something not here yet, and
  `asChild` puts it on a `Link`. `StatusBadge` for a status, and `tone="brandOutline"` for the
  outlined uppercase tagline pill.
- **Story:** [status-badge.stories.tsx](./status-badge.stories.tsx)

### `FactList`
Labels beside their values.
- **Use when:** a few facts about one thing.
- **Don't use when:** headline numbers (`MetricGrid`) or rows with columns (`SimpleTable`). Never
  a hand-built `<dl>`.
- **Props that matter:** `layout` (`inline` by default, `inset` under a row that opened it,
  `columns` for a few facts side by side, stacking on a phone); `density="compact"` in a popover
  or peek card.
- **Story:** [fact-list.stories.tsx](./fact-list.stories.tsx)

### `MetricGrid` and `MetricTile`
A page's headline numbers, each a figure over its label.
- **Props that matter:** `MetricTile` takes `label`, `value` and an optional `helperText`.
- **Story:** [metric-grid.stories.tsx](./metric-grid.stories.tsx)

### `CheckList`
Requirements, each met or not, missing ones first.
- **Use when:** a readiness check, such as a contest's setup.
- **Props that matter:** `items` (`label`, `isMet`); `surface="inverse"` on a navy panel.
- **Story:** [check-list.stories.tsx](./check-list.stories.tsx)

### `StageTrack`
A fixed run of stages with the current one marked.
- **Props that matter:** `stages`, `currentIndex`, `surface="inverse"` on a navy panel.
- **Story:** [stage-track.stories.tsx](./stage-track.stories.tsx)

### `NumberedSteps` and `StepStrip`
Steps in order under the gold numeral.
- **Use when:** `NumberedSteps` when the steps are the page's subject (tiles with an optional
  body and picture; `density="compact"` for three side by side beside a form or on a phone);
  `StepStrip` when they are a reminder (slim tiles, title and picture only).
- **Story:** [numbered-steps.stories.tsx](./numbered-steps.stories.tsx),
  [step-strip.stories.tsx](./step-strip.stories.tsx)

### `FaqList`
Questions as `ExpandableRow` rows that open to their answers.
- **Use when:** a Questions section, inside a `SectionCard` titled "Questions" or a `Tile` on a
  landing page. It draws no frame of its own.
- **Story:** [faq-list.stories.tsx](./faq-list.stories.tsx)

### `Countdown`
Days, hours and minutes to a time, heard as one timer.
- **Props that matter:** `until`, `now`, `label` ("Entries close in"), `tone="inverse"` on navy.
- **Story:** [countdown.stories.tsx](./countdown.stories.tsx)

### `OneLineRow`
Small icons capped at one line, with "+N" for the rest.
- **Props that matter:** `items`, `itemPx` (each item's width), `label`.
- **Story:** [one-line-row.stories.tsx](./one-line-row.stories.tsx)

### `CopyButton`
Copy to clipboard. It says Copied, shows an inline error when the browser refuses, and logs it.
- **Props that matter:** `text`, `label`, `iconOnly` in a tight spot.
- **Don't:** call `navigator.clipboard` in feature code.
- **Story:** [copy-button.stories.tsx](./copy-button.stories.tsx)

### `WebAddressBox`
A web address as people read it (no `https://`), with Copy.
- **Use when:** a league's or contest's address to share.
- **Props that matter:** `url` (the full address, which Copy puts on the clipboard), `isLive`,
  `notLiveHint` for why it doesn't open yet.
- **Story:** [web-address-box.stories.tsx](./web-address-box.stories.tsx)

### `DateDisplay`
A date in the viewer's zone and format.
- **Props that matter:** `tone="inherit"` takes the colour of the line around it, so pages never
  pass a colour class.
- **Story:** [date-time.stories.tsx](./date-time.stories.tsx)

### `SortableList`
A list reordered by drag or keyboard.
- **Props that matter:** `items` (each with an `id`), `renderItem` (given the drag handle's
  props), `onReorder` with the new id order.
- **Story:** [sortable-list.stories.tsx](./sortable-list.stories.tsx)

## More info

Extra information is one of four pieces, chosen by the question it answers
(`rules/ux-rules.md` §15 *Showing More*). `InfoPopover` is their internal base and is not
exported ([info-popover.stories.tsx](./info-popover.stories.tsx)).

### `HelpTip`
"How does this work?": a (?) after a page title, section title or form label opening a small
navy tooltip of one to three plain sentences and at most one link.
- **Use when:** what used to be a grey sentence under a title.
- **Don't use when:** it is about one thing on screen (`DetailsPeek`) or urgent (`Notice`).
- **Props that matter:** `label`, `learnMore` for the one link, `surface="inverse"` on navy.
- **Story:** [help-tip.stories.tsx](./help-tip.stories.tsx)

### `DetailsPeek` and `PeekCard`
"Who or what is this?": an (i) after the name of one entry, event, golfer or team opens a peek.
- **Use when:** facts about one thing in a list.
- **Props that matter:** `label`; `onHoverStart` to start a read as the mouse arrives. It opens
  after a short hover delay, so scanning a list does not flash every row, and mounts its card
  only when it opens. `PeekCard` takes `title`, `subtitle`, `facts` and one `link`.
  `EntryDetailsPeek` in `features/contests` is the product peek for an entry.
- **Story:** [details-peek.stories.tsx](./details-peek.stories.tsx)

### `ExpandableRow`
"Show me the breakdown": a row with a chevron that opens in place beneath it on a click, and
stays open so several rows can be compared. It never opens on hover.
- **Props that matter:** `summary`, `label`, `defaultOpen`, or `isOpen` with `onToggle` when the
  caller owns it. The summary can hold its own button or link, such as a peek.
- **Story:** [expandable-row.stories.tsx](./expandable-row.stories.tsx)

### `ExpandableTile`
A tile whose face opens it across its grid row.
- **Props that matter:** `face`, `isOpen` and `onToggle` (the caller owns which tile is open),
  `actions` on their own row so each stays a control of its own.
- **Story:** [expandable-tile.stories.tsx](./expandable-tile.stories.tsx)

### `Notice`
"You need to know this now": always visible, right above what it affects (a deadline, a draft,
a lock, an error, a plan limit). One sentence, plus one action if there is one.
- **Don't use when:** a page explaining itself (`HelpTip`), or a save that went through (a toast).
- **Props that matter:** `tone` (`info` by default, `warning`, `danger`, `success`), `title`,
  `action`.
- **Story:** [notice.stories.tsx](./notice.stories.tsx)

## Navigation

### `PageTabs`
A page's views as underlined tabs on the header's bottom line.
- **Props that matter:** `variant="link"` for views with their own address, `variant="state"`
  inside the page's own `Tabs` root; a tab's `count`. On a phone they scroll sideways through
  `useScrollRow`, keeping the selected tab in view.
- **Don't use when:** the views are of one card (`TabbedCard`) or narrow one list (`ViewFilter`).
- **Story:** [page-tabs.stories.tsx](./page-tabs.stories.tsx)

### `TabbedCard`
A card whose views switch by quiet tabs along its top, such as Sign in / Create account.
- **Props that matter:** `tabs`, `value`, `onValueChange`, `radius="panel"` for a card that
  stands apart from the page.
- **Story:** [tabbed-card.stories.tsx](./tabbed-card.stories.tsx)

### `Tabs` and `SegmentedControl`
The tab root `PageTabs` `variant="state"` sits in, and a segmented choice of one value.
- **Use when:** `SegmentedControl` only for choosing a value inside a form or panel.
- **Don't use when:** switching a page's views; that is `PageTabs`.
- **Story:** [tabs.stories.tsx](./tabs.stories.tsx)

### `ViewFilter`
Which rows a list shows (Active / History, Pending / Expired), with small counts.
- **Use when:** it narrows one list. It is a radio group with one Tab stop.
- **Props that matter:** `options` (`label`, `value`, `count`). It sits in a `DataGrid`'s header
  through `views`; never a second row of `PageTabs` above a grid.
- **Story:** [view-filter.stories.tsx](./view-filter.stories.tsx)

### `LeagueMenu` and `ToolsArea`
`LeagueMenu` is the one row of links every member page in a league shares, under the app bar.
`ToolsArea` frames commissioner tools and Manage: a slim navy band naming the area, what it acts
on and the way back, then the tools as link `PageTabs`, with an optional `subTabs` row for the
open tool's own choices.
- **Story:** [nav-menus.stories.tsx](./nav-menus.stories.tsx)

### `ChoiceChips`
Choices kept in the page's link, as a row of pill links that scrolls on a phone.
- **Props that matter:** `layout="wrap"` for a list of every choice, `clearable` for a narrower
  choice shown in place of the one it narrows.
- **Story:** [choice-chips.stories.tsx](./choice-chips.stories.tsx)

### `ChoiceList`
A column of indented links in a card, such as every sport and league beside How to Play's cards.
- **Props that matter:** each item's `depth` and `tone` (`heading`, `muted`).
- **Story:** [choice-list.stories.tsx](./choice-list.stories.tsx)

### `DropdownMenu`
The one dropdown menu: a button that opens a short list of choices. It never opens on hover.
- **Props that matter:** built from its parts: `DropdownMenuTrigger`, `DropdownMenuContent`,
  `DropdownMenuItem` rows (`isSelected` for the current one), `DropdownMenuLabel`,
  `DropdownMenuSeparator`.
- **Don't use when:** a row's quick actions (`RowActionsMenu`).
- **Story:** [dropdown-menu.stories.tsx](./dropdown-menu.stories.tsx)

### `RowActionsMenu`
A row's quick actions: things done or opened from the list without leaving it first.
- **Props that matter:** `actions` (`tone="danger"` for one that removes or ends something, which
  confirms before it acts), `label` naming the row ("Actions for Masters Pool").
- **Story:** [row-actions-menu.stories.tsx](./row-actions-menu.stories.tsx)

### `Pager`
"1–25 of 140" with Previous and Next, for a list that is not a table.
- **Don't use when:** the list is a `DataGrid`; give it `pageSize`.
- **Story:** [pager.stories.tsx](./pager.stories.tsx)

## Forms

### `FormField` and its inputs
A label, its input and its error. `Input`, `Select`, `Textarea`, `Checkbox` and `PasswordInput`
come from the same file.
- **Don't:** use a bare `<input>`, or `type="password"` on an `Input`; `PasswordInput` carries its
  own Show password button.
- **Story:** [form-field.stories.tsx](./form-field.stories.tsx)

### `FormPage`
A full-page edit: the page's `PageHeader`, the fields, and one Cancel/Save footer.
- **Use when:** an edit bigger than three simple fields, or one with sub-sections
  (`rules/ux-rules.md` §12 *League Pages and Commissioner Tools* item 4).
- **Don't use when:** three simple fields or fewer; that is a `FormModal`.
- **Props that matter:** `help` for how the form works; `preview` under the fields. A
  `FormPage` saved by one mutation takes its submit, pending state and error from
  `formPageSave` in `@/lib/form-page-save`.
- **Story:** [form-page.stories.tsx](./form-page.stories.tsx)

### `FormSection`
One part of a setup form inside its card.
- **Props that matter:** `title`; `step` for the number in a filled circle when the form is a
  sequence (1 Event, 2 Format); how it works goes behind a (?), never a sentence under the title.
- **Story:** [form-section.stories.tsx](./form-section.stories.tsx)

### `ChoiceCard`
A radio choice drawn as a card, for options that need more than a label.
- **Props that matter:** `isSelected`, `onSelect`, `isDisabled` (stays visible so its content can
  say why); `ChoiceCardText` for a label and description. Put the cards in `role="radiogroup"`.
- **Story:** [choice-card.stories.tsx](./choice-card.stories.tsx)

### `FilterPicker` and `YearPicker`
A labelled drop-down filter. `YearPicker` is the one season picker, the `FilterPicker` labelled
"Season".
- **Use when:** a filter that changes every tab or the whole page, in the header's `tabsEnd`;
  beside the view it narrows when a `DataGrid`'s `views` hold it (`views.end`); else at the end
  of its section's title row.
- **Story:** [filter-picker.stories.tsx](./filter-picker.stories.tsx),
  [year-picker.stories.tsx](./year-picker.stories.tsx)

### `Switch`
An on/off setting that takes effect the moment it is flipped, such as an email notification.
- **Don't use when:** the choice is saved with a form; that is a `Checkbox`.
- **Props that matter:** `checked`, `onCheckedChange`, `label` for a screen reader.
- **Story:** [switch.stories.tsx](./switch.stories.tsx)

### `DateTimeField` and `TimeZoneSelect`
A date and time entry box in the member's zone, and the time zone drop-down (US zones first).
- **Props that matter:** convert with `toDateTimeLocalValue` and `dateTimeLocalValueToIso`.
- **Story:** [date-time.stories.tsx](./date-time.stories.tsx),
  [time-zone-select.stories.tsx](./time-zone-select.stories.tsx)

### `IconPalette`
A grid of icons to choose one from, such as a league's icon on its `FormPage`.
- **Story:** [icon-palette.stories.tsx](./icon-palette.stories.tsx)

### `FileInput`
The file picker; a bare `<input type="file">` is barred in feature code.
- **Props that matter:** `onFileText` hands back the file's text.
- **Story:** [file-input.stories.tsx](./file-input.stories.tsx)

## Tables

### `DataGrid`
A table that needs search, sorting or paging.
- **Props that matter:** `search` (one box over every text column) or the header's `searchTerm`;
  `views` (a `ViewFilter` in the card's header, `end` for a filter of the chosen view, `status`
  standing in while the chosen view loads or fails); `pageSize`; `showColumnFilters` (on by
  default). A list that can grow to hundreds of rows uses `search` and `pageSize`.
- **Story:** [data-grid.stories.tsx](./data-grid.stories.tsx)

### `SimpleTable`
A small table with no search, sort or paging: a top five, a plan comparison.
- **Props that matter:** built from `TableHead`, `TableBody`, `TableRow`, `TableHeaderCell` and
  `TableCell`; `density="compact"` inside a card; `surface="inverse"` on navy; `isHighlighted`
  for the viewer's row; `numeric` for figures; `TableGroupRow` for a group heading that folds
  with the `ExpandableRow` chevron.
- **Story:** [simple-table.stories.tsx](./simple-table.stories.tsx)

### `BulkUploadPanel` and `UploadPreviewTable`
Paste or upload rows, preview what they would change, then apply.
- **Props that matter:** the caller owns the row schema, the parser and the preview and apply
  mutations, so cache invalidation stays with the feature. `UploadPreviewTable` is its preview.
- **Story:** [bulk-upload-panel.stories.tsx](./bulk-upload-panel.stories.tsx),
  [upload-preview-table.stories.tsx](./upload-preview-table.stories.tsx)

## Dialogs

Every dialog is one of four types (`rules/ux-rules.md` §3 *Placement And Layout Conventions*).
Feature code never opens the raw `Modal`.

### `FormModal`
Edit or create something of up to three simple fields, opened by a query parameter so Back and
links still work. A save closes it and confirms with a toast, never a success box.
- **Props that matter:** `saveLabel`, `onSave`, `isPending` and `pendingLabel`, `canSave`,
  `error`.
- **Story:** [modal-templates.stories.tsx](./modal-templates.stories.tsx)

### `ConfirmDialog`
Yes or no before a destructive or irreversible action: inactivate, delete, leave, remove.
- **Props that matter:** `tone="danger"` when it destroys or removes; `confirmationInput` for
  type-to-confirm; `error` for why the last try failed (a red `Notice` above the buttons, and the
  dialog stays open).
- **Story:** [confirm-dialog.stories.tsx](./confirm-dialog.stories.tsx)

### `PickerModal` and `ReadOnlyDetailModal`
Choose an item from a list; or look only: payloads and metadata, a sentence on why an action
isn't available (`size="sm"`), or a whole page shown unboxed (`size="xl"`,
`isFullScreenOnPhone`), such as a pick screen's preview.
- **Story:** [modal-templates.stories.tsx](./modal-templates.stories.tsx)

### `DialogActions` and `Modal`
`DialogActions` is the shared footer of `FormModal` and `ConfirmDialog`: Cancel, then the one
action, both held while it runs. `Modal` is the base the templates are built on; add a template
only when a dialog shape repeats across features.
- **Story:** [dialog-actions.stories.tsx](./dialog-actions.stories.tsx),
  [modal.stories.tsx](./modal.stories.tsx)

## Feedback

### `QueryState`, `LoadingState`, `EmptyState`, `ErrorState`, `InlineError`
A read's loading, error and empty states, one look everywhere (`rules/ux-rules.md` §6
*Page-Level State Communication*).
- **Use when:** `QueryState` for a query's loading, error, empty and data branches, with Retry
  from the query's own `refetch`. `ErrorState` hand-drawn takes `onRetry`
  (`refetchFailed(...)` when it waits on several reads, `null` when reading again cannot help).
  `InlineError` for a one-line failure beside what failed, such as a refused save.
- **Props that matter:** `size` (a card of its own by default, `inline` for one line inside a
  card, `tile` for a body under a fixed header, `plain` inside a padded body); `rows` for faint
  placeholder rows in a list.
- **Don't:** hand-type a `text-destructive` or "Loading..." paragraph.
- **Story:** [state.stories.tsx](./state.stories.tsx)

### `ServerErrorBar`
A failure bar with an optional Retry, for a form's blocking server error.
- **Props that matter:** `error`, `title`, `onRetry`.
- **Story:** [server-error.stories.tsx](./server-error.stories.tsx)

### `ProgressIndicator`
A bar for a value against a limit.
- **Props that matter:** `value`, `max`, `label`, `tone="danger"` past a limit.
- **Story:** [progress.stories.tsx](./progress.stories.tsx)

### Toasts: `Toaster`, `showToast`, `useMutationActionWorkflow`
A save that went through closes its dialog and confirms with a toast.
- **Use when:** completed create, update, lifecycle, copy, invite and delete outcomes. Call
  `showToast`, or give `useMutationActionWorkflow` a `successToast`; the hook also centralizes
  pending state, error feedback, query invalidation, modal close, optional navigation and
  lifecycle logging. The app's one `Toaster` is mounted at the root, so a toast outlives the
  dialog it closed or the page it left.
- **Don't use when:** validation the user must fix before submitting; that is an inline
  `Notice`, `ServerErrorBar` or `FormModal` error. Never `alert()` or a green success box.
- **Tests:** a test that asserts a toast renders `<Toaster />` beside the component; the setup
  clears toasts after each test.
- **Story:** [toast.stories.tsx](./toast.stories.tsx), [toaster.stories.tsx](./toaster.stories.tsx)

## Layout

### `StickyActionBar`
The slim bar a phone keeps at the bottom while `watch`, the block it stands in for, is out of
view: an event page's hero button, or a pick page's submit section. Wider screens never show it.
- **Story:** [sticky-action-bar.stories.tsx](./sticky-action-bar.stories.tsx)

## Primitives

### `Button` and `LinkButton`
Every button and every link drawn as a button.
- **Props that matter:** `variant` (`primary`, `secondary`, `ghost`, `inverse`, `danger`, `icon`,
  `link`), `size` (`sm`, `md`, `lg`, `icon`), `layout="row"` for a button drawn as a line of
  content (a list row, a card toggle, a pick).
- **Don't:** restyle it with `className`, which only places it (margin, width, flex);
  `poolmaster/no-button-style-override` fails a size, padding, corner, colour or type class.
  A new look is a variant here.
- **Story:** [button.stories.tsx](./button.stories.tsx)

## Product pieces

These know a product concept, so they live in the feature folder that owns it and other features
import them from there.

- **`TeamAvatar` and `TeamName`** (`features/teams`): a team's icon in its coloured square, and
  the icon beside the name, linked or plain, with the Yours and Inactive markers.
- **`FeatureList`** (`features/plans`): a plan's features one per line behind a tick or a dash,
  under a small-caps label. Features are not data rows, so it is not a `SectionRow` list.
- **`LifecyclePanel`** (`features/contests`): Manage contest's navy panel, the lifecycle
  `StageTrack`, one line on where things stand with the rule behind its (?), up to three
  numbers or the setup `CheckList`, then the stage's actions.
- **`EntryDetailsPeek`** (`features/contests`): the `DetailsPeek` for an entry.
- **The event page kit** (`features/event-pages/components`): `StartButton`, `LandingSection`,
  `PhotoHero`, `NextUpCard`, `LandingDisclaimer`.

## Page shapes

- **An admin list** is no template: a `PageHeader` (with the search box, or one action and the
  grid's own search), then a `DataGrid`, with `QueryState` for its states. Views go in the grid's
  `views`.
- **A page that waits on a read** keeps its `PageHeader` and puts `QueryState` (`size="tile"`) in
  the body, or wraps both in `PendingPage` when the header names what is read.
- **League pages and administration areas** use `LeagueMenu`, `ToolsArea`, `PageHeader`,
  settings cards, a danger-zone `SectionCard`, and `FormPage` for a full-page edit
  (`rules/ux-rules.md` §12 *League Pages and Commissioner Tools*).
- **Public and landing pages** use `NumberedSteps` or `StepStrip`, `FaqList`, `ExpandableTile`,
  `Countdown`, `StickyActionBar` and the event page kit.

## Formatting Values

A value written on screen goes through `format.ts`, exported from the index:
`formatPlace` / `formatOrdinal` ("T2", "1st"), `formatNumber`, `formatCount`
("1,000 entries"), `formatCupPoints`, `formatMoneyCents` and `formatNumberList`,
plus the date formatters from `date-time-format.ts`. Numbers take the viewer's
locale from `useDisplayPreferences().locale`, so pass it in rather than fixing
`en-US`. Feature code never calls `toLocaleString`, `toFixed` or `new Intl.*Format`
itself; `poolmaster/no-inline-display-format` enforces it
(`rules/react-ui-rules.md` §5 *Environment And Time Discipline*).

## Where a Reusable Piece Lives

- A **generic** piece, one that knows nothing about the product (a heading, a
  row button, a table, an inline state), goes in `features/shared/ui`, with a story beside it.
- A **product** piece stays in the feature folder that owns its concept, such
  as `features/teams` (a team name), `features/contests` (a leaderboard or a
  contest row), `features/event-pages` or `features/auth`. Other features import
  it from there rather than copying it or moving it into the shared layer.

## The checks that hold the catalog

Each check fails CI. Those with a baseline list today's exceptions, and the list only shrinks
(`rules:check:baseline-ratchet` fails a PR that grows one).

| Check | Fails |
|---|---|
| `rules:check:gallery-stories` | a shared component with no story beside it |
| `rules:check:text-styles` | hand-written font size, weight, case or text colour classes |
| `rules:check:card-corners` | `rounded-2xl`, `rounded-3xl` or `rounded-4xl` outside the shared layer |
| `rules:check:titled-tiles` | a `Tile` with a hand-built title instead of a `SectionCard` |
| `rules:check:page-sections` | a page file drawing more than one section itself |
| `rules:check:duplicates` | a new near-identical block in the web app |
| `poolmaster/no-hand-written-query-states` | a hand-drawn loading, error or empty line |
| `poolmaster/no-inline-display-format` | `toLocaleString`, display `toFixed` or `new Intl.*Format` |
| `poolmaster/no-panel-corner` | `radius="panel"` outside the named panels |
| `poolmaster/no-button-style-override` | a `className` that restyles a `Button`, `LinkButton` or menu item |
| `poolmaster/no-raw-modal` | a raw `Modal` in feature code, or a green success box instead of a toast |
| `poolmaster/no-bare-ui-controls` | a bare `<button>`, `<input>`, `<textarea>` or `<table>` |
| `poolmaster/no-ad-hoc-more-info` | `InfoPopover` or a hand-built tooltip instead of the four more-info pieces |
| `poolmaster/no-button-row-override` | `normal-case` or `tracking-normal` on a button instead of `layout="row"` |
| `poolmaster/no-raw-theme-colors` | a raw colour-scale class or a literal colour |
| `poolmaster/no-arbitrary-type-sizes` | a hand-typed `tracking-[…]` or `text-[…px]` |

## Theme Rules

Feature code uses semantic shared components and theme tokens, never raw scale colours. A
visual treatment belongs in the shared primitive or template that owns the pattern, not in every
page that uses it (`rules/react-ui-rules.md` §5 *Theme And Styling Discipline*).
