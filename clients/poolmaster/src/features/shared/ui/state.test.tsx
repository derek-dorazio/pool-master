import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { refetchFailed } from "./refetch-failed";
import { EmptyState, ErrorState, InlineError, LoadingState, QueryState } from "./state";

describe("LoadingState", () => {
  it("announces what is loading beside a spinner, with the shared default words when given none", () => {
    render(<LoadingState />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading...");
    expect(within(status).getByTestId("loading-spinner")).toHaveClass("motion-safe:animate-spin");
    expect(screen.queryByTestId("loading-placeholder-rows")).not.toBeInTheDocument();
  });

  it("draws faint placeholder rows under the spinner for a list, hidden from screen readers", () => {
    render(<LoadingState body="Loading members..." rows={3} />);

    const placeholders = screen.getByTestId("loading-placeholder-rows");
    expect(placeholders).toHaveAttribute("aria-hidden", "true");
    expect(within(placeholders).getAllByTestId("loading-placeholder-row")).toHaveLength(3);
  });

  it("is a card of its own as a tile, and draws no card when inline inside one", () => {
    const { rerender } = render(<LoadingState testId="members-loading" />);
    expect(screen.getByTestId("members-loading")).toHaveClass("rounded-lg", "border", "bg-card");

    rerender(<LoadingState size="inline" testId="members-loading" />);
    expect(screen.getByTestId("members-loading")).not.toHaveClass("border");
    expect(screen.getByText("Loading...")).toHaveClass("px-4", "py-3");
  });
});

describe("plain states", () => {
  it("take no padding of their own, for a body that is already padded", () => {
    render(
      <>
        <LoadingState size="plain" testId="usage-loading" />
        <ErrorState body="We couldn't load the usage." size="plain" />
        <EmptyState body="Nothing yet." size="plain" />
      </>,
    );

    expect(screen.getByText("Loading...")).not.toHaveClass("px-4");
    expect(screen.getByRole("alert")).not.toHaveClass("px-4");
    expect(screen.getByText("Nothing yet.")).not.toHaveClass("px-4");
  });
});

describe("refetchFailed", () => {
  it("runs again only the reads that failed", () => {
    const failed = { isError: true, refetch: vi.fn() };
    const loaded = { isError: false, refetch: vi.fn() };

    refetchFailed(failed, loaded)();

    expect(failed.refetch).toHaveBeenCalledTimes(1);
    expect(loaded.refetch).not.toHaveBeenCalled();
  });
});

describe("ErrorState", () => {
  it("says what failed in the error colour and announces it", () => {
    render(<ErrorState body="We couldn't load the payments." />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("We couldn't load the payments.");
    expect(alert).toHaveClass("text-destructive");
  });

  it("offers Retry, which runs the failed read again", () => {
    const onRetry = vi.fn();
    render(<ErrorState body="We couldn't load the payments." onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("leads with a bold title and keeps another way out beside Retry", () => {
    render(
      <ErrorState
        action={<Button>Back to welcome</Button>}
        body="It may have been deleted."
        onRetry={() => undefined}
        title="League not found."
      />,
    );

    expect(screen.getByText("League not found.").tagName).toBe("STRONG");
    expect(screen.getByRole("alert")).toHaveTextContent("League not found. It may have been deleted.");
    expect(screen.getByRole("button", { name: "Back to welcome" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("says the shared failure words when it is given nothing to say, and offers no Retry without a read to run", () => {
    render(<ErrorState />);

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load this right now.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("draws an inline empty state as a quiet italic line that is not announced", () => {
    render(<EmptyState body="No submitted entries yet." size="inline" />);

    const line = screen.getByText("No submitted entries yet.");
    expect(line).toHaveClass("italic", "text-muted-foreground");
    expect(line).not.toHaveAttribute("role");
  });

  it("draws a tile with its heading, its italic line and an action", () => {
    render(<EmptyState action={<Button>Create a league</Button>} body="Make one to get started." title="No leagues yet" />);

    expect(screen.getByRole("heading", { name: "No leagues yet" })).toBeInTheDocument();
    expect(screen.getByText("Make one to get started.")).toHaveClass("italic");
    expect(screen.getByRole("button", { name: "Create a league" })).toBeInTheDocument();
  });

  it("falls back to its title as the line when an inline state has no body", () => {
    render(<EmptyState size="inline" title="Nothing here" />);

    expect(screen.getByText("Nothing here").tagName).toBe("P");
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
  const refetch = () => undefined;

  it("shows the loading line, with placeholder rows when asked, while the query has no data", () => {
    render(
      <QueryState loading="Loading standings..." query={{ data: undefined, isError: false, refetch }} rows={2} testId="standings">
        {renderRows}
      </QueryState>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading standings...");
    expect(screen.getByTestId("standings-loading")).toBeInTheDocument();
    expect(screen.getAllByTestId("loading-placeholder-row")).toHaveLength(2);
  });

  it("shows the error line with Retry when the query failed, even if older data is still cached, and Retry refetches", () => {
    const failedRefetch = vi.fn();
    render(
      <QueryState error="We couldn't load the standings." query={{ data: ["Avery"], isError: true, refetch: failedRefetch }} testId="standings">
        {renderRows}
      </QueryState>,
    );

    expect(screen.getByTestId("standings-error")).toHaveTextContent("We couldn't load the standings.");
    expect(screen.queryByText("Avery")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(failedRefetch).toHaveBeenCalledTimes(1);
  });

  it("says the shared failure words when the page gives none", () => {
    render(<QueryState query={{ data: undefined, isError: true, refetch }}>{renderRows}</QueryState>);

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load this right now.");
  });

  it("shows the italic empty line when the data holds nothing to show", () => {
    render(
      <QueryState empty="No submitted entries yet." isEmpty={(rows) => rows.length === 0} query={{ data: [] as string[], isError: false, refetch }} testId="standings">
        {renderRows}
      </QueryState>,
    );

    expect(screen.getByTestId("standings-empty")).toHaveClass("italic");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders its children with the data once it is there", () => {
    render(<QueryState empty="Nobody yet." isEmpty={(rows) => rows.length === 0} query={{ data: ["Avery", "Blake"], isError: false, refetch }}>{renderRows}</QueryState>);

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Avery", "Blake"]);
  });

  it("draws its states in a card of their own when asked, for a page-level query", () => {
    render(<QueryState query={{ data: undefined, isError: false, refetch }} size="tile">{renderRows}</QueryState>);

    expect(screen.getByRole("status")).toHaveClass("rounded-lg", "border");
  });

  it("takes the empty words and the empty test only together, so an empty state never draws blank", () => {
    render(
      <>
        {/* @ts-expect-error -- empty words without a test of emptiness */}
        <QueryState empty="Nobody yet." query={{ data: ["Avery"], isError: false, refetch }}>{renderRows}</QueryState>
        {/* @ts-expect-error -- a test of emptiness with nothing to say */}
        <QueryState isEmpty={(rows: string[]) => rows.length === 0} query={{ data: ["Blake"], isError: false, refetch }}>{renderRows}</QueryState>
      </>,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
