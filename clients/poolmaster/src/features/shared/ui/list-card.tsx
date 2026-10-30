import type { HTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "./class-names";
import { Heading } from "./heading";

type ListStackProps = HTMLAttributes<HTMLDivElement>;

export function ListStack({ className, ...props }: ListStackProps) {
  return <div className={cn("space-y-3", className)} {...props} />;
}

type ListCardProps = LinkProps & {
  description?: ReactNode;
  metadata?: ReactNode;
  title: ReactNode;
  trailing?: ReactNode;
};

/** A list row that opens `to`: its title, a description and metadata, with `trailing` on the right. */
export function ListCard({
  className,
  description,
  metadata,
  title,
  to,
  trailing,
  ...linkProps
}: ListCardProps) {
  return (
    <Link
      className={cn(
        "block w-full rounded-3xl border border-border bg-background p-4 text-left text-foreground transition hover:border-primary/40 hover:bg-card sm:p-5",
        className,
      )}
      to={to}
      {...linkProps}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Heading level={3} variant="card" size="lg">{title}</Heading>
          {description ? (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          ) : null}
          {metadata ? (
            <div className="mt-2 text-sm text-muted-foreground">
              {metadata}
            </div>
          ) : null}
        </div>
        {trailing ? (
          <div className="shrink-0 rounded-2xl bg-card px-4 py-3 text-right text-sm text-muted-foreground">
            {trailing}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
