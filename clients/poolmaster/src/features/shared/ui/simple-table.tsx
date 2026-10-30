import { createContext, useContext, type ComponentProps } from "react";
import { cn } from "./class-names";

/**
 * A small table that needs no search, sort or paging (those are `DataGrid`): a top five, a
 * preview of an upload, a plan comparison. It is built from parts so a table can have row
 * headers, several bodies or a sticky first column; the parts share the table's density.
 */
type Density = "default" | "compact";
type HeaderTone = "default" | "scoreboard" | "inverse" | "plain";
type Align = "left" | "center" | "right";
/** What the table sits on: the page, or a navy panel. */
type Surface = "default" | "inverse";

const TableContext = createContext<{ density: Density; surface: Surface }>({ density: "default", surface: "default" });

const CELL_PADDING: Record<Density, string> = {
  default: "px-4 py-2",
  /** Inside a padded card: tighter, with the outer cells flush to the card's text. */
  compact: "px-1 py-1.5 first:pl-0 last:pr-0",
};

const HEADER_TONE: Record<HeaderTone, string> = {
  default: "bg-[var(--table-header-surface)] text-xs uppercase text-muted-foreground",
  /** A leaderboard's navy header with gold column names, as `DataGrid` draws it. */
  scoreboard: "bg-surface-inverse text-xs uppercase text-primary",
  /** On a navy panel: no fill of its own, and the panel's muted text. */
  inverse: "text-xs uppercase text-on-inverse-muted",
  /** Column names that are the content (plan names, a board's digits): the cells style them. */
  plain: "",
};

const ALIGN: Record<Align, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export type SimpleTableProps = ComponentProps<"table"> & {
  density?: Density;
  surface?: Surface;
};

export function SimpleTable({ className, density = "default", surface = "default", ...props }: SimpleTableProps) {
  return (
    <TableContext.Provider value={{ density, surface }}>
      <table className={cn("w-full text-left text-sm", className)} {...props} />
    </TableContext.Provider>
  );
}

export type TableHeadProps = ComponentProps<"thead"> & {
  tone?: HeaderTone;
};

export function TableHead({ className, tone, ...props }: TableHeadProps) {
  const { surface } = useContext(TableContext);
  const headerTone = tone ?? (surface === "inverse" ? "inverse" : "default");
  return <thead className={cn(HEADER_TONE[headerTone], className)} {...props} />;
}

export function TableBody(props: ComponentProps<"tbody">) {
  return <tbody {...props} />;
}

export type TableRowProps = ComponentProps<"tr"> & {
  /** The viewer's own row, or the one the page is about. */
  isHighlighted?: boolean;
};

/** A body row, ruled off from the one above. */
export function TableRow({ className, isHighlighted = false, ...props }: TableRowProps) {
  const { surface } = useContext(TableContext);
  return (
    <tr
      className={cn(
        "border-t",
        surface === "inverse" ? "border-inverse-border" : "border-border",
        isHighlighted ? "bg-primary/10" : null,
        className,
      )}
      {...props}
    />
  );
}

type CellLayout = {
  align?: Align;
  /** Figures that line up: even-width digits, set right. */
  numeric?: boolean;
};

function cellClassName(density: Density, { align, numeric }: CellLayout, className?: string) {
  return cn(CELL_PADDING[density], ALIGN[align ?? (numeric ? "right" : "left")], numeric ? "tabular-nums" : null, className);
}

export type TableHeaderCellProps = ComponentProps<"th"> & CellLayout;

/** A column heading, or a row heading with `scope="row"`. */
export function TableHeaderCell({ align, className, numeric, scope = "col", ...props }: TableHeaderCellProps) {
  const { density } = useContext(TableContext);
  return <th className={cellClassName(density, { align, numeric }, cn("font-medium", className))} scope={scope} {...props} />;
}

export type TableCellProps = ComponentProps<"td"> & CellLayout;

export function TableCell({ align, className, numeric, ...props }: TableCellProps) {
  const { density } = useContext(TableContext);
  return <td className={cellClassName(density, { align, numeric }, className)} {...props} />;
}
