import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sport, getSportDefinition } from "@poolmaster/shared/domain";
import { finishPositionUi } from "./scoring-family-ui/finish-position";
import { strokePlayUi } from "./scoring-family-ui/stroke-play";
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
    role: "GOLFER",
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

const GOLFER = getSportDefinition(Sport.GOLF).vocabulary.participant;

describe("pool-master-dn4.7: contest entry selection components", () => {
  it("rule: renders editable tier summary chips and participant option cards", async () => {
    const user = userEvent.setup();
    const handleParticipantSelect = vi.fn();
    const handleToggle = vi.fn();

    render(
      <EditableSelectionGroup
        noun={GOLFER}
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
        noun={GOLFER}
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
    render(<LockedSelectionGroup noun={GOLFER} group={buildGroup(["sep-1"])} />);

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
        isSubmitted={false}
        isSubmitting={false}
        onChange={handleChange}
        onSubmit={handleSubmit}
        submitDisabled={false}
        tiebreaker={strokePlayUi.entryTiebreaker}
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
    expect(screen.getByTestId("contest-entry-submit")).toHaveTextContent("Submit entry");
  });

  it("labels the action Save entry for an entry that is already submitted", () => {
    render(
      <TiebreakerSelector
        disabled={false}
        isSubmitted
        isSubmitting={false}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        submitDisabled={false}
        tiebreaker={strokePlayUi.entryTiebreaker}
        value="0"
      />,
    );

    expect(screen.getByTestId("contest-entry-submit")).toHaveTextContent("Save entry");
  });

  it("asks for no tiebreaker prediction for a finish-position entry and still offers Submit entry", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn();

    render(
      <TiebreakerSelector
        disabled={false}
        isSubmitted={false}
        isSubmitting={false}
        onChange={vi.fn()}
        onSubmit={handleSubmit}
        submitDisabled={false}
        tiebreaker={finishPositionUi.entryTiebreaker}
        value=""
      />,
    );

    expect(screen.queryByTestId("contest-entry-tiebreaker-select")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("contest-entry-submit"));
    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("contest entry selection: withdrawn golfers and card details", () => {
  function groupWithWithdrawn(selectedParticipantIds: string[]): SelectionGroup {
    const group = buildGroup(selectedParticipantIds);
    return {
      ...group,
      participants: group.participants.map((participant) =>
        participant.sportEventParticipantId === "sep-2"
          ? {
              ...participant,
              status: "WITHDRAWN",
              isAvailable: false,
              // What the selection state carries for a withdrawn golfer today: server text, not copy.
              unavailableReason: "SportEventParticipant sep-2 is unavailable with status WITHDRAWN",
            }
          : participant,
      ),
    };
  }

  function renderEditable(group: SelectionGroup, onParticipantSelect = vi.fn()) {
    render(
      <EditableSelectionGroup
        noun={GOLFER}
        canSelect
        group={group}
        isBusy={false}
        isExpanded
        onParticipantSelect={onParticipantSelect}
        onToggle={vi.fn()}
        setToggleRef={vi.fn()}
      />,
    );
  }

  it("keeps a held golfer who has withdrawn clickable, so the entry can unselect them", async () => {
    const onSelect = vi.fn();
    renderEditable(groupWithWithdrawn(["sep-1", "sep-2"]), onSelect);

    const withdrawn = screen.getByTestId("contest-entry-participant-sep-2");
    expect(withdrawn).toBeEnabled();
    expect(withdrawn).toHaveTextContent("Selected");

    await userEvent.setup().click(withdrawn);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ sportEventParticipantId: "sep-2" }));
  });

  it("disables a withdrawn golfer the entry does not hold, labelled with the sport's word and no server text", () => {
    renderEditable(groupWithWithdrawn(["sep-1"]));

    const withdrawn = screen.getByTestId("contest-entry-participant-sep-2");
    expect(withdrawn).toBeDisabled();
    expect(withdrawn).toHaveTextContent("Withdrawn");
    expect(withdrawn).not.toHaveTextContent("SportEventParticipant");
    expect(withdrawn).not.toHaveTextContent("WITHDRAWN");
  });

  it("disables every golfer while a pick is saving or when the viewer cannot pick", () => {
    const { rerender } = render(
      <EditableSelectionGroup
        noun={GOLFER}
        canSelect
        group={buildGroup(["sep-1"])}
        isBusy
        isExpanded
        onParticipantSelect={vi.fn()}
        onToggle={vi.fn()}
        setToggleRef={vi.fn()}
      />,
    );
    expect(screen.getByTestId("contest-entry-participant-sep-3")).toBeDisabled();

    rerender(
      <EditableSelectionGroup
        noun={GOLFER}
        canSelect={false}
        group={buildGroup(["sep-1"])}
        isBusy={false}
        isExpanded
        onParticipantSelect={vi.fn()}
        onToggle={vi.fn()}
        setToggleRef={vi.fn()}
      />,
    );
    expect(screen.getByTestId("contest-entry-participant-sep-3")).toBeDisabled();
  });

  it("shows a golfer's team, price and ranking when they have them", () => {
    const group = buildGroup([]);
    renderEditable({
      ...group,
      participants: group.participants.map((participant) =>
        participant.sportEventParticipantId === "sep-1"
          ? { ...participant, team: "USA", price: 3200 }
          : participant,
      ),
    });

    const card = screen.getByTestId("contest-entry-participant-sep-1");
    expect(card).toHaveTextContent("USA");
    expect(card).toHaveTextContent("3200 salary");
    expect(card).toHaveTextContent("Ranking #1");
  });

  it("says no golfer was saved for a locked tier the entry left empty", () => {
    render(<LockedSelectionGroup noun={GOLFER} group={buildGroup([])} />);

    expect(screen.getByText("No golfer was saved from this tier.")).toBeInTheDocument();
  });
});
