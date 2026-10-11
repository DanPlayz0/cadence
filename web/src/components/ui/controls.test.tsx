// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, SelectItem } from "./select";
import { Checkbox } from "./Checkbox";
import { Form } from "./form";
import { Input } from "./input";
import { DateField, validDate } from "./date-field";
import { Slider } from "./slider";
import { RadioGroup, Radio } from "./radio-group";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Button } from "./button";
import { QualitySelect } from "../playback/PlaybackControls";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

it("preserves empty values, disabled options, required validation and form reset", async () => {
  const user = userEvent.setup();
  const submitted = vi.fn();
  const { container } = render(
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        submitted(new FormData(event.currentTarget).getAll("library"));
      }}
    >
      <Select name="library" required aria-label="Library">
        <SelectItem value="">Choose library</SelectItem>
        <SelectItem value="blocked" disabled>
          Blocked
        </SelectItem>
        <SelectItem value="music">Music</SelectItem>
      </Select>
      <Button>Save</Button>
    </Form>,
  );
  expect(
    new FormData(container.querySelector("form")!).getAll("library"),
  ).toEqual([""]);
  await user.click(screen.getByText("Save"));
  expect(submitted).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole("combobox"));
  expect(screen.getByRole("combobox").getAttribute("aria-invalid")).toBe(
    "true",
  );
  await user.click(screen.getByRole("combobox"));
  expect(
    screen
      .getByRole("option", { name: "Blocked" })
      .getAttribute("data-disabled"),
  ).not.toBeNull();
  await user.click(screen.getByRole("option", { name: "Music" }));
  await user.click(screen.getByText("Save"));
  expect(submitted).toHaveBeenCalledWith(["music"]);
  fireEvent.reset(container.querySelector("form")!);
  await waitFor(() =>
    expect(
      new FormData(container.querySelector("form")!).getAll("library"),
    ).toEqual([""]),
  );
});

it("composite controls inherit dynamic disabled fieldsets and checkbox values submit/reset", async () => {
  const user = userEvent.setup();
  const View = ({ disabled }: { disabled: boolean }) => (
    <Form>
      <fieldset disabled={disabled}>
        <Checkbox label="Enabled" name="enabled" defaultChecked />
        <Select aria-label="Library" name="library">
          <SelectItem value="music">Music</SelectItem>
        </Select>
        <Slider aria-label="Volume" value={0.5} max={1} step={0.01} />
      </fieldset>
    </Form>
  );
  const { container, rerender } = render(<View disabled={false} />);
  expect(new FormData(container.querySelector("form")!).get("enabled")).toBe(
    "on",
  );
  await user.click(screen.getByRole("checkbox"));
  expect(new FormData(container.querySelector("form")!).has("enabled")).toBe(
    false,
  );
  fireEvent.reset(container.querySelector("form")!);
  await waitFor(() =>
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "true",
    ),
  );
  rerender(<View disabled />);
  await waitFor(() =>
    expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(true),
  );
  expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
  expect(new FormData(container.querySelector("form")!).has("library")).toBe(
    false,
  );
});

it("uses inline validation, focuses the first invalid input, and allows retry", async () => {
  const user = userEvent.setup(),
    submitted = vi.fn();
  render(
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        submitted();
      }}
    >
      <Input aria-label="Name" required />
      <DateField aria-label="From" />
      <Button>Save</Button>
    </Form>,
  );
  await user.click(screen.getByText("Save"));
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Name" }),
  );
  expect(
    screen.getByRole("textbox", { name: "Name" }).getAttribute("aria-invalid"),
  ).toBe("true");
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Danny");
  await user.type(screen.getByRole("textbox", { name: "From" }), "2026-02-30");
  await user.click(screen.getByText("Save"));
  expect(submitted).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "From" }),
  );
  await user.clear(screen.getByRole("textbox", { name: "From" }));
  await user.type(screen.getByRole("textbox", { name: "From" }), "2026-10-10");
  await user.click(screen.getByText("Save"));
  expect(submitted).toHaveBeenCalledOnce();
  expect(validDate("2024-02-29")).toBe(true);
  expect(validDate("2025-02-29")).toBe(false);
  expect(validDate("")).toBe(true);
});

it("radio groups and sliders support keyboard changes without losing precision", async () => {
  const user = userEvent.setup(),
    changed = vi.fn(),
    seek = vi.fn();
  render(
    <>
      <RadioGroup defaultValue="a" onValueChange={changed} aria-label="Icon">
        <Radio value="a" aria-label="A" />
        <Radio value="b" aria-label="B" />
      </RadioGroup>
      <Slider
        aria-label="Seek"
        value={2.1}
        min={0}
        max={100}
        step={0.1}
        onChange={(event) => seek(Number(event.target.value))}
      />
    </>,
  );
  screen.getByRole("radio", { name: "A" }).focus();
  await user.keyboard("{ArrowRight>}");
  await waitFor(() => expect(changed).toHaveBeenCalledWith("b"));
  await user.keyboard("{/ArrowRight}");
  screen.getByRole("slider").focus();
  await user.keyboard("{ArrowRight}");
  expect(seek).toHaveBeenCalledWith(2.2);
});

it("quality selection retains descriptions and closes its popup before the parent dialog", async () => {
  const user = userEvent.setup(),
    close = vi.fn();
  render(
    <Dialog open onOpenChange={close}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Settings</DialogTitle>
        <QualitySelect compact value="auto" onChange={vi.fn()} />
      </DialogContent>
    </Dialog>,
  );
  await user.click(screen.getByRole("combobox"));
  expect(screen.getByText("MP3 · 320 kbps")).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(close).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole("combobox"));
  await user.keyboard("{Escape}");
  expect(close).toHaveBeenCalledWith(false);
});

it("busy dialogs block dismissal and tabs expose linked active panels", async () => {
  const user = userEvent.setup(),
    close = vi.fn();
  const { rerender } = render(
    <Dialog open onOpenChange={close}>
      <DialogContent busy aria-describedby={undefined}>
        <DialogTitle>Saving</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
  await user.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
  rerender(
    <Tabs defaultValue="queue">
      <TabsList aria-label="Playback">
        <TabsTrigger value="queue">Queue</TabsTrigger>
        <TabsTrigger value="lyrics">Lyrics</TabsTrigger>
      </TabsList>
      <TabsContent value="queue">Queued songs</TabsContent>
      <TabsContent value="lyrics">Words</TabsContent>
    </Tabs>,
  );
  screen.getByRole("tab", { name: "Queue" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(
    screen.getByRole("tab", { name: "Lyrics" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(screen.getByRole("tabpanel").textContent).toBe("Words");
});
