import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";
import { IconAvatar } from "./icon-avatar";
import { Heading } from "./heading";

type IdentityHeadingProps = {
  /** A code people share, such as a league code, shown with a copy button. */
  code?: { label: string; value: string };
} & (
  /** An icon, drawn in the standard avatar square. */
  | { icon: ReactNode; avatar?: never }
  /** A whole avatar of the caller's own, such as a team's in its icon colours, named `<name> icon`. */
  | { avatar: ReactNode; icon?: never }
) & {
  /** Short facts after the code, such as counts. */
  meta?: ReactNode;
  name: string;
  testId?: string;
};

/** An entity's identity, once and compactly: icon, name, shareable code and a meta line. */
export function IdentityHeading({ avatar, code, icon, meta, name, testId }: IdentityHeadingProps) {
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid={testId}>
      {avatar ?? (
        <IconAvatar label={`${name} icon`} size="md">
          {icon}
        </IconAvatar>
      )}
      <div className="min-w-0 flex-1">
        <Heading data-testid={testId ? `${testId}-name` : undefined} level={1} variant="display">
          {name}
        </Heading>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {code ? <CodeChip label={code.label} value={code.value} /> : null}
          {meta}
        </div>
      </div>
    </div>
  );
}

function CodeChip({ label, value }: { label: string; value: string }) {
  return (
    // The code and the button each draw their half of the dashed border, so a refused copy's
    // message shows under the chip instead of stretching it.
    <span className="inline-flex items-start text-xs">
      <span className="h-7 rounded-l-md border border-r-0 border-dashed border-border pl-2 pr-1 font-mono leading-[26px] text-foreground">
        {value}
      </span>
      <CopyButton
        className="h-7 w-7 rounded-l-none border border-l-0 border-dashed border-border"
        iconOnly
        label={`Copy ${label}`}
        text={value}
        variant="ghost"
      />
    </span>
  );
}
