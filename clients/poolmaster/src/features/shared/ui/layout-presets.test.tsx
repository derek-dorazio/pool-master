import { render, screen } from "@testing-library/react";
import { SplitContentLayout } from "./layout-presets";

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
});
