import type { ColumnDef } from "@tanstack/react-table";
import type { AnchorHTMLAttributes } from "react";
import type { ReactNode } from "react";
import { ActionList, ActionTile } from "./action-list";
import { Button, type ButtonProps } from "./button";
import { cn } from "./class-names";
import { DataGrid } from "./data-grid";
import { DetailsActionsLayout } from "./details-actions-layout";
import { PageHeader } from "./page-header";
import { ErrorState, LoadingState } from "./state";
import { StatusBadge } from "./status-badge";
import { Tile } from "./tile";

type TemplateState = "ready" | "loading" | "error";

type HeaderConfig = {
  actions?: ReactNode;
  breadcrumbLabel?: string;
  breadcrumbs?: Array<{
    href?: string;
    label: string;
  }>;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
};

type AsyncPageStateProps = {
  errorBody?: ReactNode;
  errorTitle?: ReactNode;
  loadingBody?: ReactNode;
  state?: TemplateState;
};

function renderAsyncState({
  errorBody,
  errorTitle,
  loadingBody,
  state = "ready",
}: AsyncPageStateProps) {
  if (state === "loading") {
    return <LoadingState body={loadingBody ?? "Loading..."} />;
  }

  if (state === "error") {
    return (
      <ErrorState
        body={errorBody ?? "We could not load this information right now."}
        title={errorTitle}
      />
    );
  }

  return null;
}

type TemplatePageShellProps = AsyncPageStateProps & {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  header?: HeaderConfig;
  testId?: string;
};

function TemplatePageShell({
  children,
  className,
  contentClassName,
  header,
  testId,
  ...stateProps
}: TemplatePageShellProps) {
  const stateContent = renderAsyncState(stateProps);

  return (
    <section className={cn("space-y-6", className)} data-testid={testId}>
      {header ? <PageHeader {...header} /> : null}
      <div className={cn("space-y-6", contentClassName)}>
        {stateContent ?? children}
      </div>
    </section>
  );
}

export type AdminConfigPageProps = TemplatePageShellProps;

export function AdminConfigPage(props: AdminConfigPageProps) {
  return <TemplatePageShell {...props} />;
}

export type ManagementListPageProps<TData> = AsyncPageStateProps & {
  className?: string;
  columns: ColumnDef<TData, any>[];
  data: TData[];
  emptyMessage: string;
  filterTestIdPrefix?: string;
  getRowId?: (row: TData, index: number) => string;
  getRowLink?: (row: TData) => string;
  getRowLinkProps?: (
    row: TData,
  ) => Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;
  header?: HeaderConfig;
  rowTestId?: (row: TData, index: number) => string;
  tableTestId?: string;
  testId?: string;
};

export function ManagementListPage<TData>({
  className,
  columns,
  data,
  emptyMessage,
  filterTestIdPrefix,
  getRowId,
  getRowLink,
  getRowLinkProps,
  header,
  rowTestId,
  tableTestId,
  testId,
  ...stateProps
}: ManagementListPageProps<TData>) {
  return (
    <TemplatePageShell
      className={className}
      header={header}
      testId={testId}
      {...stateProps}
    >
      <Tile>
        <DataGrid
          columns={columns}
          data={data}
          emptyMessage={emptyMessage}
          filterTestIdPrefix={filterTestIdPrefix}
          getRowId={getRowId}
          getRowLink={getRowLink}
          getRowLinkProps={getRowLinkProps}
          rowTestId={rowTestId}
          tableTestId={tableTestId}
        />
      </Tile>
    </TemplatePageShell>
  );
}

export type DetailWithActionsPageProps = AsyncPageStateProps & {
  actions: ReactNode;
  actionsClassName?: string;
  actionsListClassName?: string;
  actionsTestId?: string;
  actionsTitle?: ReactNode;
  className?: string;
  details: ReactNode;
  detailsClassName?: string;
  header?: HeaderConfig;
  layoutClassName?: string;
  testId?: string;
};

export function DetailWithActionsPage({
  actions,
  actionsClassName,
  actionsListClassName,
  actionsTestId,
  actionsTitle,
  details,
  detailsClassName,
  layoutClassName,
  ...shellProps
}: DetailWithActionsPageProps) {
  return (
    <TemplatePageShell {...shellProps}>
      <DetailsActionsLayout
        actions={actions}
        actionsClassName={actionsClassName}
        actionsListClassName={actionsListClassName}
        actionsTestId={actionsTestId}
        actionsTitle={actionsTitle}
        className={layoutClassName}
        details={details}
        detailsClassName={detailsClassName}
      />
    </TemplatePageShell>
  );
}

export type FormEditorSectionProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  errorMessage?: ReactNode;
  footer?: ReactNode;
  testId?: string;
  title: ReactNode;
};

export function FormEditorSection({
  actions,
  children,
  className,
  description,
  errorMessage,
  footer,
  testId,
  title,
}: FormEditorSectionProps) {
  return (
    <Tile className={className} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>

      <div className="mt-5">{children}</div>

      {errorMessage ? (
        <p className="mt-4 text-sm font-medium text-destructive">
          {errorMessage}
        </p>
      ) : null}

      {footer ? (
        <div className="mt-5 flex flex-wrap justify-end gap-3">{footer}</div>
      ) : null}
    </Tile>
  );
}

export type LifecycleAction = {
  description?: ReactNode;
  disabled?: boolean;
  key: string;
  label: ReactNode;
  onSelect?: () => void;
  pending?: boolean;
  pendingLabel?: ReactNode;
  testId?: string;
  tone?: "default" | "danger" | "primary";
  visibleForStatuses?: readonly string[];
};

export type LifecycleActionSetProps = {
  actions: readonly LifecycleAction[];
  className?: string;
  currentStatus: string;
  statusTone?: "active" | "inactive" | "info" | "neutral" | "warning" | "danger";
  testId?: string;
  title?: ReactNode;
};

export function LifecycleActionSet({
  actions,
  className,
  currentStatus,
  statusTone = "neutral",
  testId,
  title = "Lifecycle",
}: LifecycleActionSetProps) {
  const visibleActions = actions.filter((action) => {
    if (!action.visibleForStatuses?.length) {
      return true;
    }

    return action.visibleForStatuses.includes(currentStatus);
  });

  return (
    <Tile className={className} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <StatusBadge tone={statusTone}>{currentStatus}</StatusBadge>
      </div>

      <ActionList className="mt-5">
        {visibleActions.map((action) => (
          <ActionTile
            data-testid={action.testId}
            description={action.description}
            disabled={action.disabled || action.pending}
            key={action.key}
            label={action.pending ? action.pendingLabel ?? action.label : action.label}
            onClick={action.onSelect}
            tone={action.tone}
          />
        ))}
      </ActionList>
    </Tile>
  );
}

export type PublicInviteJoinPageProps = AsyncPageStateProps & {
  children: ReactNode;
  className?: string;
  context?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  testId?: string;
  title: ReactNode;
};

export function PublicInviteJoinPage({
  children,
  className,
  context,
  primaryAction,
  secondaryAction,
  testId,
  title,
  ...stateProps
}: PublicInviteJoinPageProps) {
  const stateContent = renderAsyncState(stateProps);

  return (
    <main
      className={cn("mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-10", className)}
      data-testid={testId}
    >
      <Tile className="w-full" padding="lg">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {context ? <div className="mt-5">{context}</div> : null}
        <div className="mt-6">{stateContent ?? children}</div>
        {primaryAction || secondaryAction ? (
          <div className="mt-6 flex flex-wrap gap-3">
            {primaryAction}
            {secondaryAction}
          </div>
        ) : null}
      </Tile>
    </main>
  );
}

export type FormEditorActionProps = Pick<
  ButtonProps,
  "children" | "disabled" | "isLoading" | "onClick" | "variant"
>;

export function FormEditorAction(props: FormEditorActionProps) {
  return <Button type="button" {...props} />;
}
