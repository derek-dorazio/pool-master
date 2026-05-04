import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import {
  ContestSetupSummary,
  ContestTemplatePicker,
  EventReadinessPanel,
  TierSettingsEditor,
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

  it("rule: renders editable tier settings and reports updates", () => {
    const onUpdateTier = vi.fn();
    const onResetTiers = vi.fn();

    render(
      <TierSettingsEditor
        isDraftEditable
        onResetTiers={onResetTiers}
        onUpdateTier={onUpdateTier}
        tiers={[
          {
            endPosition: 10,
            label: "Tier A",
            pickCount: 2,
            startPosition: 1,
            tierKey: "A",
          },
        ]}
      />,
    );

    fireEvent.change(screen.getByTestId("contest-tier-label-A"), {
      target: { value: "Top tier" },
    });
    expect(onUpdateTier).toHaveBeenCalledWith(0, { label: "Top tier" });

    fireEvent.click(screen.getByTestId("contest-tiered-reset-tiers"));
    expect(onResetTiers).toHaveBeenCalledTimes(1);
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
});
