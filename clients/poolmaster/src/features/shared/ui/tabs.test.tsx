import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  SegmentedControl,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./tabs";

describe("pool-master-3lo.13: shared Tabs and SegmentedControl primitives", () => {
  it("rule: renders tab triggers and content", () => {
    render(
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="active">Active contests</TabsContent>
      </Tabs>,
    );

    expect(screen.getByRole("tab", { name: "Active" })).toBeInTheDocument();
    expect(screen.getByText("Active contests")).toBeInTheDocument();
  });

  it("marks the selected tab in the selected-tab blue with white text, and leaves the others plain", () => {
    render(
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(screen.getByRole("tab", { name: "Active" })).toHaveClass("data-[state=active]:bg-selected");
    expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("data-state", "inactive");
  });

  it("marks the chosen segment in the selected-tab blue with white text", () => {
    render(
      <SegmentedControl
        aria-label="Contest view"
        onChange={vi.fn()}
        options={[
          { label: "Active", value: "active" },
          { label: "History", value: "history" },
        ]}
        value="active"
      />,
    );

    expect(screen.getByRole("radio", { name: "Active" })).toHaveClass("bg-selected", "text-on-inverse");
    expect(screen.getByRole("radio", { name: "History" })).not.toHaveClass("bg-selected");
  });

  it("rule: renders segmented controls with radio semantics", () => {
    const handleChange = vi.fn();

    render(
      <SegmentedControl
        aria-label="Contest view"
        onChange={handleChange}
        options={[
          { label: "Active", value: "active" },
          { label: "History", value: "history" },
        ]}
        value="active"
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "History" }));

    expect(handleChange).toHaveBeenCalledWith("history");
  });

  it("is one Tab stop, on the chosen segment, so Tab moves past the group in one step", async () => {
    render(
      <>
        <button type="button">Before</button>
        <SegmentedControl
          aria-label="Contest view"
          onChange={() => undefined}
          options={[
            { label: "Active", value: "active" },
            { label: "History", value: "history" },
          ]}
          value="history"
        />
        <button type="button">After</button>
      </>,
    );

    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "History" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  it("moves to and picks the next or previous segment with the arrow keys, wrapping and passing over a disabled one", async () => {
    function Control() {
      const [value, setValue] = useState("all");
      return (
        <SegmentedControl
          aria-label="Members to show"
          onChange={setValue}
          options={[
            { label: "All", value: "all" },
            { disabled: true, label: "Owners", value: "owners" },
            { label: "Inactive", value: "inactive" },
          ]}
          value={value}
        />
      );
    }
    render(<Control />);
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "All" })).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Inactive" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Inactive" })).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();

    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Inactive" })).toBeChecked();

    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("radio", { name: "All" })).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("radio", { name: "Inactive" })).toHaveFocus();
  });

  it("lets Tab reach the first segment when none is chosen, and the arrow keys start from the ends", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="Contest view"
        onChange={onChange}
        options={[
          { label: "Active", value: "active" },
          { label: "History", value: "history" },
        ]}
        value=""
      />,
    );

    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Active" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith("history");
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("active");
  });

  it("lands Shift+Tab on the last segment when none is chosen, as a native radio group does", async () => {
    render(
      <>
        <SegmentedControl
          aria-label="Contest view"
          onChange={() => undefined}
          options={[
            { label: "Active", value: "active" },
            { label: "History", value: "history" },
          ]}
          value=""
        />
        <button type="button">After</button>
      </>,
    );
    screen.getByRole("button", { name: "After" }).focus();

    await userEvent.tab({ shift: true });

    expect(screen.getByRole("radio", { name: "History" })).toHaveFocus();
  });
});
