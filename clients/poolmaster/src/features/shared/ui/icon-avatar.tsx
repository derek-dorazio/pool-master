import type { ReactNode } from "react";
import { cn } from "./class-names";

type IconAvatarProps = {
  children: ReactNode;
  className?: string;
  label?: string;
  selected?: boolean;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "inverse" | "muted";
};

const sizeClassNames = {
  sm: "h-9 w-9",
  md: "h-12 w-12",
  lg: "h-16 w-16",
};

const toneClassNames = {
  default: "bg-primary/10 text-primary",
  inverse: "bg-primary text-primary-foreground",
  muted: "bg-background text-muted-foreground",
};

export function IconAvatar({
  children,
  className,
  label,
  selected = false,
  size = "md",
  tone = "default",
}: IconAvatarProps) {
  return (
    <span
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-2xl border",
        sizeClassNames[size],
        toneClassNames[tone],
        selected ? "border-primary" : "border-transparent",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function IconBadge(props: IconAvatarProps) {
  return <IconAvatar size="sm" {...props} />;
}
