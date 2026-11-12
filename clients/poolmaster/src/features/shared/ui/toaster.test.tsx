import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toaster } from "./toaster";
import { dismissAllToasts, dismissToast, showToast } from "./toast-store";

describe("Toaster", () => {
  it("shows each toast called for anywhere in the app, in order, with its second line", () => {
    render(<Toaster />);

    act(() => {
      showToast({ title: "Profile saved", tone: "success" });
      showToast({ title: "You left Big Dawgs", description: "Your entries stay on past leaderboards." });
    });

    const toasts = screen.getAllByTestId("app-toast");
    expect(toasts).toHaveLength(2);
    expect(toasts[0]).toHaveTextContent("Profile saved");
    expect(toasts[1]).toHaveTextContent("Your entries stay on past leaderboards.");
  });

  it("removes a dismissed toast and clears them all on request", () => {
    render(<Toaster />);
    let first = 0;
    act(() => {
      first = showToast({ title: "First" });
      showToast({ title: "Second" });
    });

    act(() => dismissToast(first));
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();

    act(() => dismissAllToasts());
    expect(screen.queryByTestId("app-toast")).not.toBeInTheDocument();
  });
});
