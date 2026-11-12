import { createContext, useContext, type ReactNode } from "react";
import { Button } from "./button";
import { SectionCard } from "./section-card";
import { Text } from "./text";

/** Rows inside a `SettingsSection` take its look: label left, value and action right. */
const InlineSettingsRowsContext = createContext(false);

type SettingsSectionProps = {
  children: ReactNode;
  /** Opens the section's `FormModal`; without it the section has no Edit button. */
  onEdit?: () => void;
  editTestId?: string;
  /** How the section works, behind the title's (?). */
  help?: ReactNode;
  testId?: string;
  title: string;
  /** `danger` for the account or league section whose actions destroy or hide. */
  tone?: "default" | "danger";
};

/**
 * A settings section, "see it, then Edit": the current values as `SettingsRow`s, label left and
 * value right, in a `SectionCard` whose title holds one Edit button that opens the section's
 * `FormModal`. A row may carry its own action instead, such as a switch that saves on flip or a
 * Change button. A grouped list of label/value rows, so it maps one to one onto a native
 * settings screen.
 */
export function SettingsSection({ children, editTestId, help, onEdit, testId, title, tone = "default" }: SettingsSectionProps) {
  const trailing = onEdit ? (
    <Button aria-label={`Edit ${title}`} data-testid={editTestId} onClick={onEdit} size="sm" variant="secondary">
      Edit
    </Button>
  ) : undefined;
  const rows = (
    <InlineSettingsRowsContext.Provider value>
      <SettingsRows testId={testId ? `${testId}-rows` : undefined}>{children}</SettingsRows>
    </InlineSettingsRowsContext.Provider>
  );
  return tone === "danger" ? (
    <SectionCard help={help} testId={testId} title={title} tone="danger" trailing={trailing}>{rows}</SectionCard>
  ) : (
    <SectionCard help={help} testId={testId} title={title} trailing={trailing}>{rows}</SectionCard>
  );
}

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
  /** The setting's current value; a row whose action is the setting, such as a switch, has none. */
  value?: ReactNode;
};

/**
 * One setting: its label, its current value, and an optional trailing action. In a
 * `SettingsSection` the label sits left and the value and action right, on one line even on a
 * phone; elsewhere the label has its own column from a tablet up.
 */
export function SettingsRow({ action, label, testId, value }: SettingsRowProps) {
  const inline = useContext(InlineSettingsRowsContext);
  if (inline) {
    return (
      <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2 even:bg-row-alt" data-testid={testId}>
        <Text as="div" className="flex min-w-0 items-center gap-1" variant="meta">{label}</Text>
        <div className="flex min-w-0 items-center justify-end gap-3 text-right">
          {value !== undefined ? <Text as="div" className="min-w-0 break-words" variant="strong" weight="semibold">{value}</Text> : null}
          {action}
        </div>
      </div>
    );
  }
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
