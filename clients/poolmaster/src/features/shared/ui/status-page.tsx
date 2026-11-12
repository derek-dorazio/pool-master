import { CircleAlert, CircleCheck, CircleHelp, Info, Timer, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Heading } from "./heading";
import { Text } from "./text";
import { Tile } from "./tile";

/** What the page is saying, which picks its symbol. */
export type StatusPageKind = "notFound" | "error" | "expired" | "done" | "confirm";

const SYMBOLS: Record<StatusPageKind, { icon: LucideIcon; tone: string }> = {
  notFound: { icon: CircleHelp, tone: "text-muted-foreground" },
  error: { icon: CircleAlert, tone: "text-destructive" },
  expired: { icon: Timer, tone: "text-muted-foreground" },
  done: { icon: CircleCheck, tone: "[color:var(--status-active-text)]" },
  confirm: { icon: Info, tone: "text-primary" },
};

type StatusPageProps = {
  /** The one primary action: a `LinkButton` or a `Button`. */
  action?: ReactNode;
  /** One plain line under the title. */
  body: ReactNode;
  bodyTestId?: string;
  /** Anything that must sit above the action, such as a danger `Notice` after a failed try. */
  children?: ReactNode;
  kind: StatusPageKind;
  testId?: string;
  title: string;
};

/**
 * A page that is only a status: not found, a crash, a dead or expired link, or a done or
 * confirm step after a link from an email. A symbol (? not found, ! error, ⏱ expired, ✓ done,
 * i confirm), a title, one plain line and one primary action, centred in the standard card.
 * Never more sentences: how something works goes behind a (?) elsewhere.
 */
export function StatusPage({ action, body, bodyTestId, children, kind, testId, title }: StatusPageProps) {
  const { icon: Icon, tone } = SYMBOLS[kind];
  return (
    <Tile
      as="section"
      aria-labelledby={testId ? `${testId}-title` : undefined}
      className="mx-auto flex max-w-md flex-col items-center gap-4 text-center"
      data-kind={kind}
      data-testid={testId}
    >
      <Icon aria-hidden className={`size-10 ${tone}`} data-testid={testId ? `${testId}-symbol` : undefined} />
      <Heading id={testId ? `${testId}-title` : undefined} level={1} variant="section">{title}</Heading>
      <Text as="p" data-testid={bodyTestId} variant="meta">{body}</Text>
      {children}
      {action ? <div className="flex flex-wrap justify-center gap-3">{action}</div> : null}
    </Tile>
  );
}
