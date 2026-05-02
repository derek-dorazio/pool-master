# PoolMaster Shared UI

The shared UI layer is split into three levels:

1. **Primitives** own a single reusable control or visual pattern, such as
   `Button`, `Tile`, `Modal`, `DataGrid`, `ActionTile`, and `StatusBadge`.
2. **Templates** compose primitives into repeated page or modal workflows, such
   as `ManagementListPage`, `DetailWithActionsPage`, `FormModal`, and
   `ConfirmationModal`.
3. **Feature pages** own product-specific data fetching, mutations, copy, and
   business rules. They should compose primitives and templates instead of
   repeating page chrome or modal footers.

## Page Templates

Use page templates when a page matches an existing workflow shape:

- `AdminConfigPage` for root-admin configuration screens with shared page
  chrome, loading, and error states.
- `ManagementListPage` for admin list screens backed by `DataGrid`.
- `DetailWithActionsPage` for profile/entity details with summary tiles on the
  left and less frequent actions on the right.
- `FormEditorSection` for repeated editable configuration sections with
  consistent title, errors, and footer actions.
- `LifecycleActionSet` for status-aware activate, inactivate, delete, and leave
  actions.
- `PublicInviteJoinPage` for public invitation or join surfaces.

Feature pages should keep route-specific copy and generated-SDK calls local, but
they should not duplicate header, grid-shell, detail/actions, lifecycle, or
public-join layout code when a template fits.

## Modal Templates

Use modal templates when the modal follows one of the common workflows:

- `FormModal` for edit/create forms.
- `ConfirmationModal` for destructive or lifecycle confirmations, including
  exact-match confirmation inputs.
- `ActionModal` for compact action workflows launched from action menus.
- `PickerModal` for selecting an item from a constrained list.
- `IconPickerModal` is the current icon-specific picker specialization; keep
  icon catalogs domain-owned, and move only generic picker behavior into
  `PickerModal`.
- `ReadOnlyDetailModal` for payloads, audit details, and operational metadata.
- `WizardModal` for multi-step flows where a modal remains the right
  interaction model.

Modals should use the templates for predictable footer ordering, pending state,
scroll behavior, and error placement. Add a new template only when a workflow
shape repeats across multiple features or materially improves accessibility.

## Theme Rules

Feature code should use semantic shared components and theme tokens. Avoid raw
scale colors in feature code. Visual treatments belong in the shared primitive
or template that owns the pattern, not in every page that consumes it.
