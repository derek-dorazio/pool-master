import { render, screen } from "@testing-library/react";
import { LeagueSummaryCard } from "./league-summary-card";

describe("pool-master-pjr.6: league summary card component", () => {
  it("rule: renders league identity, role, and headline metrics", () => {
    render(
      <LeagueSummaryCard
        activeContestCount={3}
        description="Office tournament league"
        icon={<span aria-hidden="true">icon</span>}
        memberCount={12}
        name="Mathworks"
        roleLabel="Commissioner"
      />,
    );

    expect(screen.getByTestId("league-summary-tile")).toBeInTheDocument();
    expect(screen.getByText("Commissioner")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mathworks" })).toBeInTheDocument();
    expect(screen.getByText("Office tournament league")).toBeInTheDocument();
    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Active contests")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
