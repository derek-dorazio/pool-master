import { Ellipsis } from "lucide-react";
import { Link } from "react-router";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuTriggerSlot,
} from "./dropdown-menu";
import { Icon } from "./icon";

/** One quick action: something done or opened from the list without leaving it first. */
export type RowAction = {
  label: string;
  testId?: string;
  /** `danger` for a choice that removes or ends something; it should confirm before it acts. */
  tone?: "default" | "danger";
} & (
  | { onSelect: () => void; to?: never }
  | { to: string; onSelect?: never }
);

type RowActionsMenuProps = {
  actions: RowAction[];
  /** The button's accessible name, naming the row, e.g. "Actions for Masters Pool". */
  label: string;
  testId?: string;
};

/**
 * The "⋯" at the end of a list row (rules/ux-rules.md §12): the row itself opens the item, and
 * this menu holds the quick actions. A row with no quick actions shows no button. A destructive
 * action opens a `ConfirmDialog` from its `onSelect` and ends with a toast.
 */
export function RowActionsMenu({ actions, label, testId }: RowActionsMenuProps) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTriggerSlot>
        <Button aria-label={label} className="w-9 px-0" data-testid={testId} size="sm" type="button" variant="ghost">
          <Icon icon={Ellipsis} size={18} />
        </Button>
      </DropdownMenuTriggerSlot>
      <DropdownMenuContent align="end" testId={testId ? `${testId}-menu` : undefined} width="md">
        {actions.map((action) => {
          const text = <DropdownMenuItemText name={action.label} tone={action.tone} />;
          return action.to !== undefined ? (
            <DropdownMenuItem asChild data-testid={action.testId} key={action.label}>
              <Link to={action.to}>{text}</Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem data-testid={action.testId} key={action.label} onSelect={action.onSelect}>
              {text}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
