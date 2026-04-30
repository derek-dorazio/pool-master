import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "./class-names";

type ActionListProps = {
  children: ReactNode;
  className?: string;
};

export function ActionList({ children, className }: ActionListProps) {
  return <div className={cn("space-y-2", className)}>{children}</div>;
}

type ActionTileBaseProps = {
  description?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
  tone?: "default" | "danger" | "primary";
  trailing?: ReactNode;
};

const actionTileClassName =
  "flex w-full items-center justify-between gap-4 rounded-[1.25rem] border px-4 py-3 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";

function actionToneClassName(tone: ActionTileBaseProps["tone"]) {
  if (tone === "danger") {
    return "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15";
  }

  if (tone === "primary") {
    return "border-primary/30 bg-primary/10 text-foreground hover:border-primary/40 hover:bg-primary/15";
  }

  return "border-border bg-background text-foreground hover:border-primary/40 hover:bg-card";
}

function ActionTileContent({
  description,
  icon,
  label,
  trailing,
}: ActionTileBaseProps) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span className="shrink-0 text-muted-foreground">{icon}</span>
        ) : null}
        <span className="min-w-0">
          <span className="block">{label}</span>
          {description ? (
            <span className="mt-1 block text-sm font-normal text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
      </span>
      {trailing ? (
        <span className="shrink-0 text-muted-foreground">{trailing}</span>
      ) : null}
    </>
  );
}

type ButtonActionTileProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ActionTileBaseProps & {
    to?: never;
  };

type LinkActionTileProps = LinkProps &
  ActionTileBaseProps & {
    disabled?: never;
  };

export function ActionTile({
  className,
  description,
  icon,
  label,
  tone = "default",
  to,
  trailing,
  ...props
}: ButtonActionTileProps | LinkActionTileProps) {
  const composedClassName = cn(
    actionTileClassName,
    actionToneClassName(tone),
    className,
  );

  if (to) {
    const linkProps = props as Omit<LinkProps, "to">;

    return (
      <Link className={composedClassName} to={to} {...linkProps}>
        <ActionTileContent
          description={description}
          icon={icon}
          label={label}
          trailing={trailing}
        />
      </Link>
    );
  }

  return (
    <button
      className={composedClassName}
      type="button"
      {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      <ActionTileContent
        description={description}
        icon={icon}
        label={label}
        trailing={trailing}
      />
    </button>
  );
}
