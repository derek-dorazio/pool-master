import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FaqList } from "./faq-list";

const ITEMS = [
  { question: "Is it free?", answer: "Every new league gets a preview period." },
  { question: "Can I change the rules?", answer: "Any rule, before picks close." },
];

describe("FaqList", () => {
  it("lists every question with its answer hidden until that question is opened", () => {
    render(<FaqList items={ITEMS} />);

    expect(screen.getByText("Is it free?")).toBeVisible();
    expect(screen.getByText("Every new league gets a preview period.")).not.toBeVisible();

    fireEvent.click(screen.getByText("Is it free?"));
    expect(screen.getByText("Every new league gets a preview period.")).toBeVisible();
    expect(screen.getByText("Any rule, before picks close.")).not.toBeVisible();
  });
});
