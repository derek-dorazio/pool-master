import { fireEvent, render, screen } from "@testing-library/react";
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
});
