import type { ReactNode } from "react";
import { Tile } from "./tile";

type StateProps = {
  action?: ReactNode;
  body?: ReactNode;
  testId?: string;
  title?: ReactNode;
};

function StateTile({ action, body, testId, title }: StateProps) {
  return (
    <Tile data-testid={testId} padding="lg">
      {title ? (
        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
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

export function LoadingState({ body = "Loading...", ...props }: StateProps) {
  return <StateTile body={body} {...props} />;
}

export function ErrorState(props: StateProps) {
  return <StateTile {...props} />;
}
