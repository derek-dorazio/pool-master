import type { ReactNode } from "react";
import { cn } from "./class-names";

type SettingsSectionProps = {
  action?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  testId?: string;
  title: ReactNode;
};

/** A titled group of settings rows, with one optional action (usually Edit) for the group. */
export function SettingsSection({ action, children, description, testId, title }: SettingsSectionProps) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <SettingsSectionHeader action={action} description={description} title={title} />
      <div className="divide-y divide-border rounded-2xl border border-border bg-card">{children}</div>
    </section>
  );
}

/** A settings-style section title, for a section whose body is not a card of rows (a table). */
export function SettingsSectionHeader({
  action,
  description,
  title,
  tone = "default",
}: {
  action?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
  tone?: "danger" | "default";
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className={cn("font-display text-lg font-extrabold", tone === "danger" ? "text-destructive" : "text-foreground")}>
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

type SettingsRowProps = {
  action?: ReactNode;
  label: ReactNode;
  testId?: string;
  value: ReactNode;
};

/** One setting: its label, its current value, and an optional trailing action. */
export function SettingsRow({ action, label, testId, value }: SettingsRowProps) {
  return (
    <div
      className="grid gap-x-4 gap-y-1 px-5 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center"
      data-testid={testId}
    >
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm text-foreground">{value}</div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

type DangerZoneProps = {
  children: ReactNode;
  description?: ReactNode;
  testId?: string;
  title?: ReactNode;
};

/**
 * Destructive actions, kept in their own marked section at the bottom of a settings page and
 * never beside everyday actions. Each action confirms before it runs.
 */
export function DangerZone({
  children,
  description = "Each of these asks you to confirm.",
  testId,
  title = "Danger zone",
}: DangerZoneProps) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <SettingsSectionHeader description={description} title={title} tone="danger" />
      <div className="divide-y divide-border rounded-2xl border border-destructive/40 bg-card">{children}</div>
    </section>
  );
}

type DangerZoneActionProps = {
  action: ReactNode;
  description: ReactNode;
  testId?: string;
  title: ReactNode;
};

export function DangerZoneAction({ action, description, testId, title }: DangerZoneActionProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4" data-testid={testId}>
      <div className="max-w-xl">
        <div className="font-semibold text-foreground">{title}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
