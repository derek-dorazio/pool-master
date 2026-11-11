import type { ReactNode } from "react";

/**
 * A `SectionCard`'s settings rows, or a danger zone's actions: divided, each a `SettingsRow` or
 * `DangerZoneAction`. The section itself is the `SectionCard` (#1562).
 */
export function SettingsRows({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div className="divide-y divide-border" data-testid={testId}>{children}</div>;
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
      className="grid gap-x-4 gap-y-1 px-4 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center"
      data-testid={testId}
    >
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm text-foreground">{value}</div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

type DangerZoneActionProps = {
  action: ReactNode;
  description: ReactNode;
  testId?: string;
  title: ReactNode;
};

/** One destructive action in a danger zone (`SectionCard` with `tone="danger"`): what it does, and its button, which confirms before it runs. */
export function DangerZoneAction({ action, description, testId, title }: DangerZoneActionProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4" data-testid={testId}>
      <div className="max-w-xl">
        <div className="font-semibold text-foreground">{title}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
