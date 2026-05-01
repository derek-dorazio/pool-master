import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, type ButtonProps } from "./button";
import { cn } from "./class-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export type AppNavigationItem = {
  disabled?: boolean;
  hidden?: boolean;
  isActive?: boolean;
  label: ReactNode;
  testId?: string;
  to: string;
};

type AppNavigationMenuProps = {
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  items: AppNavigationItem[];
  label: ReactNode;
  onItemSelect?: () => void;
  triggerTestId?: string;
};

export function AppNavigationMenu({
  className,
  contentClassName,
  disabled = false,
  items,
  label,
  onItemSelect,
  triggerTestId,
}: AppNavigationMenuProps) {
  const visibleItems = items.filter((item) => !item.hidden);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={className}
          data-testid={triggerTestId}
          disabled={disabled}
          type="button"
          variant="secondary"
        >
          {label}
          <ChevronDown aria-hidden size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={cn("min-w-56", contentClassName)}>
        {visibleItems.map((item) => (
          <DropdownMenuItem
            asChild
            className={cn(
              "px-0 py-0",
              item.isActive
                ? "bg-primary/10 text-foreground focus:bg-primary/15"
                : undefined,
            )}
            disabled={item.disabled}
            key={`${item.testId ?? item.to}-${item.to}`}
            onSelect={onItemSelect}
          >
            <Link
              aria-current={item.isActive ? "page" : undefined}
              className={cn(
                "block w-full rounded-xl px-3 py-2 text-sm font-medium outline-none",
                item.disabled
                  ? "pointer-events-none text-muted-foreground opacity-50"
                  : "text-foreground",
              )}
              data-testid={item.testId}
              to={item.to}
            >
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type AppIconActionButtonProps = Omit<ButtonProps, "children" | "variant"> & {
  icon: ReactNode;
  label: string;
};

export function AppIconActionButton({
  className,
  icon,
  label,
  title,
  ...props
}: AppIconActionButtonProps) {
  return (
    <Button
      aria-label={label}
      className={cn("h-12 w-12 px-0", className)}
      title={title ?? label}
      type="button"
      variant="secondary"
      {...props}
    >
      {icon}
    </Button>
  );
}
