import { render, screen } from "@testing-library/react";
import { Button } from "./button";
import { PageSection, SectionHeader } from "./section";

describe("pool-master-pjr.12: shared section primitives", () => {
  it("rule: renders section content, heading, description, and actions", () => {
    render(
      <PageSection testId="section">
        <SectionHeader
          actions={<Button type="button">Save</Button>}
          description="Configure the visible section."
          title="Contest template"
        />
        <p>Section body</p>
      </PageSection>,
    );

    expect(screen.getByTestId("section")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contest template" })).toBeInTheDocument();
    expect(screen.getByText("Configure the visible section.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByText("Section body")).toBeInTheDocument();
  });
});
