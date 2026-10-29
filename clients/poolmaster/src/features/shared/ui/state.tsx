import type { AriaRole, ReactNode } from "react";
import { LOADING_TEXT } from "./state-copy";
import { Tile } from "./tile";
import { Heading } from "./heading";

type StateProps = {
  action?: ReactNode;
  body?: ReactNode;
  testId?: string;
  title?: ReactNode;
};

type StateTileProps = StateProps & {
  ariaLive?: "polite" | "assertive";
  role?: AriaRole;
};

function StateTile({ action, ariaLive, body, role, testId, title }: StateTileProps) {
  return (
    <Tile aria-live={ariaLive} data-testid={testId} padding="lg" role={role}>
      {title ? (
        <Heading level={2} variant="page">{title}</Heading>
      ) : null}
      {body ? (
        <p
          className={
            title
              ? "mt-2 text-sm text-muted-foreground"
              : "text-sm text-muted-foreground"
          }
        >
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Tile>
  );
}

export function EmptyState(props: StateProps) {
  return <StateTile {...props} />;
}

export function LoadingState({ body = LOADING_TEXT, ...props }: StateProps) {
  return <StateTile ariaLive="polite" body={body} role="status" {...props} />;
}

export function ErrorState(props: StateProps) {
  return <StateTile ariaLive="assertive" role="alert" {...props} />;
}
