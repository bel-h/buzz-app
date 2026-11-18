// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { CompactionField } from "./Compaction";
import { compactAt } from "./compact-at";

afterEach(cleanup);

it("accepts whole thousands from 100K and nothing else", () => {
  expect(compactAt("100000")).toBe(100000);
  expect(compactAt("150000")).toBe(150000);
  for (const value of ["99000", "150500", "1e5", "", undefined, 150000])
    expect(compactAt(value)).toBeUndefined();
});

function Harness({ saved }: { saved: string[] }) {
  const [value, setValue] = useState<string | undefined>("200000");
  return (
    <CompactionField
      value={value}
      onChange={(next) => {
        saved.push(next);
        setValue(next || undefined);
      }}
    />
  );
}

it("saves only valid sizes and shows the model default when blank", async () => {
  const user = userEvent.setup();
  const saved: string[] = [];
  render(<Harness saved={saved} />);
  const field = screen.getByRole("textbox", { name: "Auto-compact at" });
  expect(field).toHaveValue("200");
  expect(field).toHaveAccessibleDescription(
    "Compacts at this size, or earlier if the model's context window is smaller. thousand tokens",
  );

  await user.clear(field);
  expect(field).toHaveAttribute("placeholder", "Model default");
  expect(saved).toEqual([""]);

  await user.type(field, "50");
  expect(screen.getByRole("alert")).toHaveTextContent("at least 100K");
  await user.tab();
  expect(field).toHaveValue("");
  expect(screen.queryByRole("alert")).toBeNull();

  await user.type(field, "150");
  expect(saved.at(-1)).toBe("150000");
  expect(screen.queryByRole("alert")).toBeNull();
});
