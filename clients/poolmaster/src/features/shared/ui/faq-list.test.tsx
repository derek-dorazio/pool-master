import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FaqList } from "./faq-list";

const ITEMS = [
  { question: "Is it free?", answer: "Every new league gets a preview period." },
  { question: "Can I change the rules?", answer: "Any rule, before picks close." },
];

describe("FaqList", () => {
  it("lists every question with its answer hidden until that question's row is opened", () => {
    render(<FaqList items={ITEMS} />);

    expect(screen.getByText("Is it free?")).toBeVisible();
    expect(screen.queryByText("Every new league gets a preview period.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Is it free?" }));
    expect(screen.getByText("Every new league gets a preview period.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Is it free?" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("Any rule, before picks close.")).not.toBeInTheDocument();
  });

  it("keeps several answers open at once, to compare them", () => {
    render(<FaqList items={ITEMS} />);

    fireEvent.click(screen.getByRole("button", { name: "Is it free?" }));
    fireEvent.click(screen.getByRole("button", { name: "Can I change the rules?" }));

    expect(screen.getByText("Every new league gets a preview period.")).toBeVisible();
    expect(screen.getByText("Any rule, before picks close.")).toBeVisible();
  });

  it("draws no frame of its own, so it sits inside the section card around it", () => {
    render(<FaqList items={ITEMS} testId="faq" />);

    expect(screen.getByTestId("faq")).not.toHaveClass("border");
    expect(screen.getByTestId("faq")).not.toHaveClass("rounded-2xl");
  });
});
