import type { ColumnDef } from "@tanstack/react-table";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "./class-names";
import { DataGrid } from "./data-grid";
import { DetailsActionsLayout } from "./details-actions-layout";
import { PageHeader } from "./page-header";
import { ServerErrorBar } from "./server-error";
import { EmptyState, ErrorState, LoadingState } from "./state";
import { Tile } from "./tile";

type TemplateState = "ready" | "loading" | "error" | "empty" | "forbidden";

// #84 — one id for every template page's load-failure state, so a browser spec can tell a
// page that rendered its landmark around an error from one that loaded.
const SHARED_ERROR_STATE_TEST_ID = "shared-error-state";

// The permission state is its own id, not the load-failure one: "you may not see this" and
// "this did not load" fail a spec for different reasons and should not report as one.
const SHARED_FORBIDDEN_STATE_TEST_ID = "shared-forbidden-state";

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
  emptyAction?: ReactNode;
  emptyBody?: ReactNode;
  emptyTitle?: ReactNode;
  errorBody?: ReactNode;
  error?: Error | null;
  errorAction?: ReactNode;
  errorTitle?: ReactNode;
  loadingBody?: ReactNode;
  onRetry?: () => void;
  permissionBody?: ReactNode;
  permissionTitle?: ReactNode;
  retryLabel?: string;
  state?: TemplateState;
};

function renderAsyncState({
  emptyAction,
  emptyBody,
  emptyTitle,
  error,
  errorAction,
  errorBody,
  errorTitle,
  loadingBody,
  onRetry,
  permissionBody,
  permissionTitle,
  retryLabel,
  state = "ready",
}: AsyncPageStateProps) {
  if (state === "loading") {
    return <LoadingState body={loadingBody ?? "Loading..."} />;
  }

  if (state === "error") {
    if (error) {
      return (
        <ServerErrorBar
          action={errorAction}
          error={error}
          fallback={
            typeof errorBody === "string"
              ? errorBody
              : "We could not load this information right now."
          }
          onRetry={onRetry}
          retryLabel={retryLabel}
          testId={SHARED_ERROR_STATE_TEST_ID}
          title={typeof errorTitle === "string" ? errorTitle : "Unable to load"}
        />
      );
    }

    return (
      <ErrorState
        action={errorAction}
        body={errorBody ?? "We could not load this information right now."}
        testId={SHARED_ERROR_STATE_TEST_ID}
        title={errorTitle}
      />
    );
  }

  if (state === "empty") {
    return (
      <EmptyState
        action={emptyAction}
        body={emptyBody ?? "There is nothing to show yet."}
        title={emptyTitle}
      />
    );
  }

  if (state === "forbidden") {
    return (
      <ErrorState
        body={permissionBody ?? "You do not have access to this page."}
        testId={SHARED_FORBIDDEN_STATE_TEST_ID}
        title={permissionTitle ?? "Access unavailable"}
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

export type AsyncPageProps = TemplatePageShellProps;

export function AsyncPage(props: AsyncPageProps) {
  return <TemplatePageShell {...props} />;
}

export type AdminConfigPageProps = TemplatePageShellProps;

export function AdminConfigPage(props: AdminConfigPageProps) {
  return <TemplatePageShell {...props} />;
}

export type ManagementListPageProps<TData> = AsyncPageStateProps & {
  className?: string;
  // TanStack's ColumnDef<TData, TValue> is invariant in TValue, so a heterogeneous column
  // array cannot name a single TValue -- `unknown` rejects ColumnDef<Row, string>. `any` is
  // TanStack's own documented shape for this position.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  contentClassName?: string;
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

export type DataGridPageProps<TData> = ManagementListPageProps<TData>;

export function DataGridPage<TData>({
  className,
  columns,
  contentClassName,
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
      contentClassName={contentClassName}
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

export function ManagementListPage<TData>(props: ManagementListPageProps<TData>) {
  return <DataGridPage {...props} />;
}

export type EntityDetailPageProps = AsyncPageStateProps & {
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
  summary?: ReactNode;
  summaryClassName?: string;
  testId?: string;
};

export function EntityDetailPage({
  actions,
  actionsClassName,
  actionsListClassName,
  actionsTestId,
  actionsTitle,
  details,
  detailsClassName,
  layoutClassName,
  summary,
  summaryClassName,
  ...shellProps
}: EntityDetailPageProps) {
  return (
    <TemplatePageShell {...shellProps}>
      {summary ? <div className={summaryClassName}>{summary}</div> : null}
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
