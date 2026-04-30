import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Pagination, ResultsSummary } from "./pagination";

describe("pool-master-3lo.16: shared Pagination and ResultsSummary primitives", () => {
  it("rule: renders pagination state and invokes navigation callbacks", () => {
    const handleNext = vi.fn();
    const handlePrevious = vi.fn();

    render(
      <Pagination
        canGoNext
        canGoPrevious={false}
        onNext={handleNext}
        onPrevious={handlePrevious}
        page={2}
        pageCount={4}
      />,
    );

    expect(screen.getByText("Page 2 of 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(handleNext).toHaveBeenCalledTimes(1);
  });

  it("rule: summarizes the visible result range", () => {
    render(<ResultsSummary page={3} pageSize={10} total={24} />);

    expect(screen.getByText("Showing 21-24 of 24 results")).toBeInTheDocument();
  });
});
