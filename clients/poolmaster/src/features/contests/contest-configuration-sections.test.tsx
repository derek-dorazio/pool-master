import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import {
  ContestSetupSummary,
  ContestTemplatePicker,
  EventReadinessPanel,
  InheritedTiersPanel,
} from "./contest-configuration-sections";

describe("pool-master-pjr.8: contest configuration section components", () => {
  it("rule: renders selectable contest templates and default status", () => {
    const onSelectTemplate = vi.fn();

    render(
      <ContestTemplatePicker
        isEditMode={false}
        onSelectTemplate={onSelectTemplate}
        selectedTemplateId="template-1"
        templates={[
          {
            description: "Pick by tiers.",
            id: "template-1",
            isDefault: true,
            name: "Tiered Pick 6",
            templateKey: "golf-tiered-pick-6",
          } as never,
        ]}
      />,
    );

    expect(screen.getByText("Contest template")).toBeInTheDocument();
    expect(screen.getByText("Tiered Pick 6")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("contest-template-golf-tiered-pick-6"));
    expect(onSelectTemplate).toHaveBeenCalledWith("template-1");
  });

  it("rule: renders event readiness and field metadata", () => {
    render(
      <EventReadinessPanel
        event={{
          contestEligible: true,
          fieldLocksAt: "2026-04-10T12:00:00.000Z",
          participantCount: 80,
          readinessReasons: [],
          readinessStatus: "CONTEST_ELIGIBLE",
          releaseAt: "2026-04-01T12:00:00.000Z",
          status: "SCHEDULED",
        } as never}
        formatDateTimeDisplay={(value) => value ?? "Unavailable"}
        formatReadinessLabel={() => "Contest ready"}
        formatReadinessReasons={() => "This event is ready for contest setup."}
      />,
    );

    expect(screen.getByText("Selected event readiness")).toBeInTheDocument();
    expect(screen.getByText("Contest ready")).toBeInTheDocument();
    expect(screen.getByText("Participants loaded")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
  });

  it("rule: renders the contest setup summary choices", () => {
    render(
      <ContestSetupSummary
        items={[
          { id: "league", label: "League", value: "Mathworks" },
          { id: "mode", label: "Mode", value: "Golf tiered contest" },
        ]}
      />,
    );

    expect(screen.getByText("Current choices")).toBeInTheDocument();
    expect(screen.getByText("Mathworks")).toBeInTheDocument();
    expect(screen.getByText("Golf tiered contest")).toBeInTheDocument();
  });

  // pool-master-41t — read-only inherited tier display (plans/124 §4.6/§5.3).
  it("rule: renders inherited tournament tiers read-only with golfer counts", () => {
    const assignment = (id: string) => ({
      sportEventParticipantId: `sep-${id}`,
      participantId: `g-${id}`,
      tierOrderIndex: 0,
      price: 0,
    });
    const tiers: ComponentProps<typeof InheritedTiersPanel>["tiers"] = [
      {
        tierKey: "tier-1",
        label: "Tier 1",
        tierNumber: 1,
        defaultPickCount: 2,
        assignments: [assignment("1"), assignment("2")],
      },
      {
        tierKey: "tier-2",
        label: "Tier 2",
        tierNumber: 2,
        defaultPickCount: 1,
        assignments: [assignment("3")],
      },
    ];

    render(<InheritedTiersPanel tiers={tiers} />);

    expect(screen.getByText("Inherited tournament tiers")).toBeInTheDocument();
    expect(screen.getByTestId("inherited-tier-tier-1")).toHaveTextContent("1. Tier 1");
    expect(screen.getByTestId("inherited-tier-tier-1")).toHaveTextContent("2 golfers · 2 picks by default");
    expect(screen.getByTestId("inherited-tier-tier-2")).toHaveTextContent("1 golfer · 1 pick by default");
    // No edit affordances — the panel is a pure read-only echo.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inherited-tiers-empty")).not.toBeInTheDocument();
  });

  it("rule: shows the empty state when the tournament has no tiers defined yet", () => {
    render(<InheritedTiersPanel tiers={[]} />);

    expect(screen.getByTestId("inherited-tiers-empty")).toHaveTextContent(
      "This tournament has no tiers defined yet.",
    );
    expect(screen.queryByTestId("inherited-tiers-list")).not.toBeInTheDocument();
  });
});
