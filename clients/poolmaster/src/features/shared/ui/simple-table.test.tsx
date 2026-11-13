import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SimpleTable,
  TableBody,
  TableCell,
  TableGroupRow,
  TableHead,
  TableHeaderCell,
  TableRow,
  type SimpleTableProps,
  type TableHeadProps,
} from "./simple-table";

function renderTable(props: {
  density?: SimpleTableProps["density"];
  surface?: SimpleTableProps["surface"];
  tone?: TableHeadProps["tone"];
}) {
  return render(
    <SimpleTable density={props.density} surface={props.surface}>
      <TableHead data-testid="head" tone={props.tone}>
        <tr>
          <TableHeaderCell>Team</TableHeaderCell>
          <TableHeaderCell numeric>Points</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        <TableRow data-testid="row-mine" isHighlighted>
          <TableCell>Mine</TableCell>
          <TableCell numeric>12</TableCell>
        </TableRow>
        <TableRow data-testid="row-other">
          <TableCell>Other</TableCell>
          <TableCell numeric>9</TableCell>
        </TableRow>
      </TableBody>
    </SimpleTable>,
  );
}

describe("SimpleTable", () => {
  it("gives the header the shared table-header fill and small uppercase column names by default", () => {
    renderTable({});

    const head = screen.getByTestId("head");
    expect(head).toHaveClass("bg-[var(--table-header-surface)]", "uppercase", "text-muted-foreground");
  });

  it("draws a scoreboard header navy with gold column names, as the leaderboard does", () => {
    renderTable({ tone: "scoreboard" });

    expect(screen.getByTestId("head")).toHaveClass("bg-surface-inverse", "text-primary");
  });

  it("drops the header fill and uses the navy panel's muted text when the table sits on a navy panel", () => {
    renderTable({ surface: "inverse" });

    const head = screen.getByTestId("head");
    expect(head).toHaveClass("text-on-inverse-muted");
    expect(head).not.toHaveClass("bg-[var(--table-header-surface)]");
    expect(screen.getByTestId("row-other")).toHaveClass("border-inverse-border");
  });

  it("leaves a plain header unstyled so its cells can carry content such as plan names", () => {
    renderTable({ tone: "plain" });

    expect(screen.getByTestId("head")).toHaveClass("", { exact: true });
  });

  it("shades only the highlighted row, so the viewer finds their own entry", () => {
    renderTable({});

    expect(screen.getByTestId("row-mine")).toHaveClass("bg-primary/10");
    expect(screen.getByTestId("row-other")).not.toHaveClass("bg-primary/10");
  });

  it("sets numeric columns right-aligned in even-width digits and other columns left", () => {
    renderTable({});

    const mine = screen.getByTestId("row-mine");
    expect(within(mine).getByRole("cell", { name: "12" })).toHaveClass("text-right", "tabular-nums");
    expect(within(mine).getByRole("cell", { name: "Mine" })).toHaveClass("text-left");
    expect(screen.getByRole("columnheader", { name: "Points" })).toHaveClass("text-right");
  });

  it("tightens every cell in a compact table and keeps the default padding otherwise", () => {
    const { unmount } = renderTable({ density: "compact" });
    expect(screen.getByRole("cell", { name: "Mine" })).toHaveClass("px-1", "py-1.5");
    unmount();

    renderTable({});
    expect(screen.getByRole("cell", { name: "Mine" })).toHaveClass("px-4", "py-2");
  });

  it("heads a group with its label spanning the columns, as a row group heading with no toggle", () => {
    render(
      <SimpleTable>
        <TableBody>
          <TableGroupRow colSpan={3} label="Limits" testId="group" />
        </TableBody>
      </SimpleTable>,
    );

    const heading = within(screen.getByTestId("group")).getByRole("rowheader", { name: "Limits" });
    expect(heading).toHaveAttribute("colspan", "3");
    expect(heading).toHaveAttribute("scope", "rowgroup");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("makes a foldable group's label the toggle, saying whether it is open, with its counts beside it while folded", () => {
    const onToggle = vi.fn();
    render(
      <SimpleTable>
        <TableBody>
          <TableGroupRow cells={<TableCell>4 of 12</TableCell>} isOpen={false} label="Emails" onToggle={onToggle} toggleTestId="toggle" />
        </TableBody>
      </SimpleTable>,
    );

    const toggle = screen.getByTestId("toggle");
    expect(toggle).toHaveAccessibleName("Emails");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("cell", { name: "4 of 12" })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
