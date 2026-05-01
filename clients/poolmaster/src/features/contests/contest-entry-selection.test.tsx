import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  EditableSelectionGroup,
  LockedSelectionGroup,
  TiebreakerSelector,
  type SelectionGroup,
} from "./contest-entry-selection";

function buildParticipant(
  id: string,
  name: string,
  orderIndex: number,
  isSelected = false,
) {
  return {
    sportEventParticipantId: id,
    participantId: `participant-${id}`,
    participantName: name,
    position: "GOLFER",
    team: undefined,
    status: "ACTIVE",
    price: undefined,
    ranking: orderIndex,
    orderIndex,
    isAvailable: true,
    unavailableReason: undefined,
    isSelected,
  };
}

function buildGroup(
  selectedParticipantIds: string[] = [],
): SelectionGroup {
  return {
    groupId: "tier-a",
    groupName: "Tier A",
    groupNumber: 1,
    picksFromGroup: 2,
    selectedParticipantIds,
    participants: [
      buildParticipant("sep-1", "Scottie Scheffler", 1, selectedParticipantIds.includes("sep-1")),
      buildParticipant("sep-2", "Rory McIlroy", 2, selectedParticipantIds.includes("sep-2")),
      buildParticipant("sep-3", "Ludvig Aberg", 3, selectedParticipantIds.includes("sep-3")),
    ],
  };
}

describe("pool-master-dn4.7: contest entry selection components", () => {
  it("rule: renders editable tier summary chips and participant option cards", async () => {
    const user = userEvent.setup();
    const handleParticipantSelect = vi.fn();
    const handleToggle = vi.fn();

    render(
      <EditableSelectionGroup
        canSelect
        group={buildGroup(["sep-1"])}
        isBusy={false}
        isExpanded
        onParticipantSelect={handleParticipantSelect}
        onToggle={handleToggle}
        setToggleRef={vi.fn()}
      />,
    );

    expect(screen.getByTestId("contest-entry-group-tier-a")).toBeInTheDocument();
    expect(screen.getAllByText("Scottie Scheffler")).toHaveLength(2);
    expect(screen.getByText("1/2 saved")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Selected" })).toBeChecked();

    await user.click(
      screen.getByTestId("contest-entry-participant-sep-2"),
    );

    expect(handleParticipantSelect).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventParticipantId: "sep-2" }),
    );

    await user.click(screen.getByTestId("contest-entry-group-toggle-tier-a"));
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });

  it("rule: marks replacement choices when a tier is full", () => {
    render(
      <EditableSelectionGroup
        canSelect
        group={buildGroup(["sep-1", "sep-2"])}
        isBusy={false}
        isExpanded
        onParticipantSelect={vi.fn()}
        onToggle={vi.fn()}
        setToggleRef={vi.fn()}
      />,
    );

    expect(screen.getByText("2/2 saved")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Replace selection" }),
    ).toBeInTheDocument();
  });

  it("rule: renders locked selections as read-only rows", () => {
    render(<LockedSelectionGroup group={buildGroup(["sep-1"])} />);

    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(
      screen.getByTestId("contest-entry-locked-participant-tier-a-sep-1"),
    ).toHaveTextContent("Scottie Scheffler");
  });

  it("rule: renders the tiebreaker selector and submit action", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    const handleSubmit = vi.fn();

    render(
      <TiebreakerSelector
        disabled={false}
        isSubmitting={false}
        onChange={handleChange}
        onSubmit={handleSubmit}
        options={[2, 1, 0, -1]}
        submitDisabled={false}
        value=""
      />,
    );

    await user.selectOptions(
      screen.getByTestId("contest-entry-tiebreaker-select"),
      "-1",
    );
    await user.click(screen.getByTestId("contest-entry-submit"));

    expect(handleChange).toHaveBeenCalledWith("-1");
    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });
});
