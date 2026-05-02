import { render, screen } from "@testing-library/react";
import {
  ResponsiveGridLayout,
  SplitContentLayout,
  SummaryMediaLayout,
} from "./layout-presets";

describe("pool-master-pjr.13: responsive layout presets", () => {
  it("rule: renders split content layout with main and aside regions", () => {
    render(
      <SplitContentLayout
        aside={<p>Preview</p>}
        main={<p>Editor</p>}
      />,
    );

    expect(screen.getByText("Editor")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("rule: renders summary and responsive grid layout children", () => {
    render(
      <SummaryMediaLayout aside={<p>Metrics</p>}>
        <ResponsiveGridLayout>
          <p>Identity</p>
          <p>Status</p>
        </ResponsiveGridLayout>
      </SummaryMediaLayout>,
    );

    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Metrics")).toBeInTheDocument();
  });
});
