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
