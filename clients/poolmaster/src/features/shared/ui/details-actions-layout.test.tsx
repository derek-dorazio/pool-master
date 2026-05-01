import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DetailsActionsLayout } from "./details-actions-layout";

describe("pool-master-dn4.3: shared DetailsActionsLayout", () => {
  it("renders page-owned details beside a standardized actions tile", () => {
    render(
      <DetailsActionsLayout
        actions={<button type="button">Open</button>}
        actionsTestId="detail-actions"
        details={<section aria-label="Detail summary">Summary</section>}
      />,
    );

    expect(screen.getByLabelText("Detail summary")).toHaveTextContent("Summary");
    expect(screen.getByTestId("detail-actions")).toHaveTextContent("Actions");
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("allows feature pages to override the actions title and spacing hooks", () => {
    render(
      <DetailsActionsLayout
        actions={<button type="button">Invite</button>}
        actionsListClassName="custom-action-spacing"
        actionsTestId="league-actions"
        actionsTitle="League operations"
        details={<section>League details</section>}
      />,
    );

    expect(screen.getByTestId("league-actions")).toHaveTextContent("League operations");
    expect(screen.getByTestId("league-actions").querySelector(".custom-action-spacing")).not.toBeNull();
  });
});
