import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "./class-names";

type ListStackProps = HTMLAttributes<HTMLDivElement>;

export function ListStack({ className, ...props }: ListStackProps) {
  return <div className={cn("space-y-3", className)} {...props} />;
}

type ListCardBaseProps = {
  actions?: ReactNode;
  description?: ReactNode;
  metadata?: ReactNode;
  title: ReactNode;
  trailing?: ReactNode;
};

const listCardClassName =
  "block w-full rounded-[1.5rem] border border-border bg-background p-5 text-left text-foreground transition";

const interactiveListCardClassName = "hover:border-primary/40 hover:bg-card";

function ListCardContent({
  actions,
  description,
  metadata,
  title,
  trailing,
}: ListCardBaseProps) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
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
      {actions ? <div className="mt-5 flex flex-wrap gap-3">{actions}</div> : null}
    </>
  );
}

type StaticListCardProps = HTMLAttributes<HTMLDivElement> &
  ListCardBaseProps & {
    to?: never;
  };

type ButtonListCardProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ListCardBaseProps & {
    to?: never;
  };

type LinkListCardProps = LinkProps &
  ListCardBaseProps & {
    disabled?: never;
  };

export function ListCard({
  actions,
  className,
  description,
  metadata,
  title,
  to,
  trailing,
  ...props
}: StaticListCardProps | ButtonListCardProps | LinkListCardProps) {
  const children = (
    <ListCardContent
      actions={actions}
      description={description}
      metadata={metadata}
      title={title}
      trailing={trailing}
    />
  );

  if (to) {
    const linkProps = props as Omit<LinkProps, "to">;

    return (
      <Link
        className={cn(listCardClassName, interactiveListCardClassName, className)}
        to={to}
        {...linkProps}
      >
        {children}
      </Link>
    );
  }

  if ("onClick" in props || "disabled" in props) {
    const buttonProps = props as ButtonHTMLAttributes<HTMLButtonElement>;

    return (
      <button
        className={cn(listCardClassName, interactiveListCardClassName, className)}
        type="button"
        {...buttonProps}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      className={cn(listCardClassName, className)}
      {...(props as HTMLAttributes<HTMLDivElement>)}
    >
      {children}
    </div>
  );
}

type ListEmptyRowProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function ListEmptyRow({ children, className, ...props }: ListEmptyRowProps) {
  return (
    <div
      className={cn(
        "rounded-[1.5rem] border border-dashed border-border bg-background p-5 text-sm text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
