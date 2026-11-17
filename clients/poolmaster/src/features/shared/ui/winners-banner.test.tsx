import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WinnersBanner, type WinnersPlace } from "./winners-banner";

const winner: WinnersPlace = { label: "Winner", metal: "gold", names: ["Big Hitters"], score: "11 pts" };
const second: WinnersPlace = { label: "2nd", metal: "silver", names: ["Lakers 2"], score: "10 pts" };
const third: WinnersPlace = { label: "3rd", metal: "bronze", names: ["Sharks 1"], score: "9 pts" };

describe("WinnersBanner", () => {
  it("is a Winners section with the gold winner and their score, then 2nd and 3rd with silver and bronze trophies", () => {
    render(<WinnersBanner runnersUp={[second, third]} testId="winners" winner={winner} yourFinish={null} />);

    const banner = screen.getByRole("region", { name: "Winners" });
    expect(within(screen.getByTestId("winners-winner")).getByTestId("trophy-mark")).toHaveAttribute("data-metal", "gold");
    expect(screen.getByTestId("winners-winner")).toHaveTextContent("WinnerBig Hitters11 pts");
    expect(within(screen.getByTestId("winners-silver")).getByTestId("trophy-mark")).toHaveAttribute("data-metal", "silver");
    expect(screen.getByTestId("winners-silver")).toHaveTextContent("2ndLakers 2 · 10 pts");
    expect(within(screen.getByTestId("winners-bronze")).getByTestId("trophy-mark")).toHaveAttribute("data-metal", "bronze");
    expect(within(banner).queryByTestId("winners-yours")).not.toBeInTheDocument();
  });

  it("names everyone tied, and adds the viewer's finish on its own line when they entered", () => {
    render(
      <WinnersBanner
        runnersUp={[]}
        testId="winners"
        winner={{ ...winner, label: "Tied for 1st", names: ["Big Hitters", "Lakers 2"] }}
        yourFinish="You finished 5th of 14"
      />,
    );

    expect(screen.getByTestId("winners-winner-names")).toHaveTextContent("Big Hitters, Lakers 2");
    expect(screen.getByText("Tied for 1st")).toBeInTheDocument();
    expect(screen.getByTestId("winners-yours")).toHaveTextContent("You finished 5th of 14");
  });
});
