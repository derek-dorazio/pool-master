import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { EmptyState, ErrorState, InlineError, LoadingState, QueryState } from "./state";

describe("pool-master-3lo.7: shared page state primitives", () => {
  it("rule: renders loading copy in a shared state tile", () => {
    render(<LoadingState body="Loading contests..." />);

    expect(screen.getByText("Loading contests...")).toBeInTheDocument();
  });

  it("rule: renders error and empty states with optional actions", () => {
    render(
      <>
        <ErrorState body="Could not load users." title="Failed" />
        <EmptyState action={<Button>Refresh</Button>} body="No rows found." />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Failed" })).toBeInTheDocument();
    expect(screen.getByText("No rows found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("draws an inline state as one padded line inside a card, with no tile or title", () => {
    render(<LoadingState size="inline" testId="standings-loading" title="Ignored" />);

    const line = screen.getByTestId("standings-loading");
    expect(line.tagName).toBe("P");
    expect(line).toHaveTextContent("Loading...");
    expect(line).toHaveAttribute("role", "status");
    expect(line).toHaveClass("px-4", "py-4", "text-sm", "text-muted-foreground");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("draws an inline error in the error colour and announces it", () => {
    render(<ErrorState body="We couldn't load the standings." size="inline" />);

    expect(screen.getByRole("alert")).toHaveClass("text-destructive");
  });

  it("draws an inline empty state as a quiet line that is not announced", () => {
    render(<EmptyState body="No submitted entries yet." size="inline" />);

    const line = screen.getByText("No submitted entries yet.");
    expect(line).toHaveClass("text-muted-foreground");
    expect(line).not.toHaveAttribute("role");
  });
});

describe("InlineError", () => {
  it("announces a one-line failure as an alert in the error colour, keeping the id a field points at", () => {
    render(<InlineError id="price-error" testId="save-error">That price is taken.</InlineError>);

    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("That price is taken.");
    expect(error).toHaveClass("text-sm", "text-destructive");
    expect(error).toHaveAttribute("id", "price-error");
    expect(error).toHaveAttribute("data-testid", "save-error");
  });
});

describe("QueryState", () => {
  const renderRows = (rows: string[]) => <ul>{rows.map((row) => <li key={row}>{row}</li>)}</ul>;

  it("shows the loading line while the query has no data", () => {
    render(<QueryState loading="Loading standings..." query={{ data: undefined, isError: false }}>{renderRows}</QueryState>);

    expect(screen.getByRole("status")).toHaveTextContent("Loading standings...");
  });

  it("shows the error line when the query failed, even if older data is still cached", () => {
    render(<QueryState error="We couldn't load the standings." query={{ data: ["Avery"], isError: true }}>{renderRows}</QueryState>);

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load the standings.");
    expect(screen.queryByText("Avery")).not.toBeInTheDocument();
  });

  it("shows the empty line when the data holds nothing to show", () => {
    render(
      <QueryState empty="No submitted entries yet." isEmpty={(rows) => rows.length === 0} query={{ data: [] as string[], isError: false }}>
        {renderRows}
      </QueryState>,
    );

    expect(screen.getByText("No submitted entries yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders its children with the data once it is there", () => {
    render(<QueryState isEmpty={(rows) => rows.length === 0} query={{ data: ["Avery", "Blake"], isError: false }}>{renderRows}</QueryState>);

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Avery", "Blake"]);
  });

  it("draws its states as tiles when asked, for a page-level query", () => {
    render(<QueryState query={{ data: undefined, isError: false }} size="tile">{renderRows}</QueryState>);

    expect(screen.getByRole("status").tagName).toBe("DIV");
  });
});
