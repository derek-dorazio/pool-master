import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { DateTimeField } from "./date-time";
import { FileInput } from "./file-input";
import { Checkbox, Input, Select, Textarea } from "./form-field";
import { Tile } from "./tile";
import { TimeZoneSelect } from "./time-zone-select";

describe("shared UI controls take a ref as an ordinary prop", () => {
  it("hands Button's ref to its button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Save</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("hands Input, DateTimeField and FileInput refs to their input elements", () => {
    const input = createRef<HTMLInputElement>();
    const dateTime = createRef<HTMLInputElement>();
    const file = createRef<HTMLInputElement>();
    render(
      <>
        <Input ref={input} />
        <DateTimeField ref={dateTime} />
        <FileInput ref={file} />
      </>,
    );
    expect(input.current).toBeInstanceOf(HTMLInputElement);
    expect(dateTime.current?.type).toBe("datetime-local");
    expect(file.current?.type).toBe("file");
  });

  it("hands Checkbox's ref to its input and still sets the indeterminate state", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox indeterminate ref={ref} />);
    expect(ref.current?.type).toBe("checkbox");
    expect(ref.current?.indeterminate).toBe(true);
  });

  it("hands Select, TimeZoneSelect, Textarea and Tile refs to their elements", () => {
    const select = createRef<HTMLSelectElement>();
    const zone = createRef<HTMLSelectElement>();
    const textarea = createRef<HTMLTextAreaElement>();
    const tile = createRef<HTMLDivElement>();
    render(
      <>
        <Select ref={select} />
        <TimeZoneSelect ref={zone} value="America/New_York" />
        <Textarea ref={textarea} />
        <Tile ref={tile} />
      </>,
    );
    expect(select.current).toBeInstanceOf(HTMLSelectElement);
    expect(zone.current?.value).toBe("America/New_York");
    expect(textarea.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(tile.current).toBeInstanceOf(HTMLDivElement);
  });
});
