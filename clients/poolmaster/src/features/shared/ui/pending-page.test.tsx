import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PendingPage } from "./pending-page";
import { LoadingState } from "./state";

describe("PendingPage", () => {
  it("draws a hidden header placeholder above the loading state, so the frame stays while the body swaps", () => {
    render(
      <PendingPage testId="team">
        <LoadingState body="Loading this member..." testId="team-loading" />
      </PendingPage>,
    );

    const header = screen.getByTestId("team-header");
    expect(header).toHaveAttribute("aria-hidden", "true");
    expect(header.compareDocumentPosition(screen.getByTestId("team-loading")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent("Loading this member...");
    expect(screen.queryByTestId("team-header-tabs")).not.toBeInTheDocument();
  });

  it("adds a placeholder tab row only for a page whose header has tabs", () => {
    render(
      <PendingPage hasTabs testId="contest">
        <LoadingState />
      </PendingPage>,
    );

    expect(screen.getByTestId("contest-header-tabs")).toBeInTheDocument();
  });
});
