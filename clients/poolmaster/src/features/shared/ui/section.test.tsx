import { render, screen } from "@testing-library/react";
import { Button } from "./button";
import { SectionHeader } from "./section";

describe("pool-master-pjr.12: shared section primitives", () => {
  it("rule: renders the section heading, description, and actions", () => {
    render(
      <>
        <SectionHeader
          actions={<Button type="button">Save</Button>}
          description="Configure the visible section."
          title="Contest template"
        />
        <p>Section body</p>
      </>,
    );

    expect(screen.getByRole("heading", { name: "Contest template" })).toBeInTheDocument();
    expect(screen.getByText("Configure the visible section.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByText("Section body")).toBeInTheDocument();
  });
});
