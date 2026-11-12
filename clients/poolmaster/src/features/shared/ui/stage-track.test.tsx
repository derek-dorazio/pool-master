import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageTrack } from "./stage-track";

const STAGES = ["Set up", "Open", "Live", "Final"];

describe("StageTrack", () => {
  it("marks the stages before the current one done, the current one current, and the rest to come", () => {
    render(<StageTrack currentIndex={2} stages={STAGES} testId="track" />);

    expect(screen.getByTestId("track-0")).toHaveAttribute("data-state", "done");
    expect(screen.getByTestId("track-1")).toHaveAttribute("data-state", "done");
    expect(screen.getByTestId("track-2")).toHaveAttribute("data-state", "current");
    expect(screen.getByTestId("track-3")).toHaveAttribute("data-state", "upcoming");
  });

  it("tells a screen reader which stage is current and which are done, in order", () => {
    render(<StageTrack currentIndex={1} stages={STAGES} testId="track" />);

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Set up, done"),
      expect.stringContaining("Open, current stage"),
      expect.stringContaining("Live, to come"),
      expect.stringContaining("Final, to come"),
    ]);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
  });

  it("numbers the current and upcoming stages and shows no number on a done one", () => {
    render(<StageTrack currentIndex={1} stages={STAGES} testId="track" />);

    expect(screen.getByTestId("track-0")).not.toHaveTextContent("1");
    expect(screen.getByTestId("track-1")).toHaveTextContent(/^2Open/);
    expect(screen.getByTestId("track-3")).toHaveTextContent(/^4Final/);
  });

  it("draws the track in the navy panel's colours on an inverse surface", () => {
    render(<StageTrack currentIndex={0} stages={STAGES} surface="inverse" testId="track" />);

    expect(screen.getByText("Set up")).toHaveClass("text-on-inverse");
    expect(screen.getByText("Open")).toHaveClass("text-label-on-inverse");
  });
});
