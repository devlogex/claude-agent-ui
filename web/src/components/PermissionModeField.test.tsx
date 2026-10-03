import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PERMISSION_HELP, PermissionModeField } from "./PermissionModeField.tsx";
import type { PermissionMode } from "../lib/api.ts";

/**
 * The dangerous opt-in. These are the three properties the CEO decision actually names, so
 * they are asserted rather than left to a reviewer's eye: `ask` starts selected, the sentence is
 * the agreed one, and the bypass choice does not take effect on the click.
 */

function Harness({ onChange = vi.fn() }: { onChange?: (mode: PermissionMode) => void }) {
  const [value, setValue] = useState<PermissionMode>("ask");
  return (
    <PermissionModeField
      value={value}
      cwd="/work/trusted-repo"
      onChange={(mode) => {
        setValue(mode);
        onChange(mode);
      }}
    />
  );
}

describe("PermissionModeField", () => {
  it("preselects ask and shows the agreed sentence verbatim", () => {
    render(<Harness />);

    expect(screen.getByRole("radio", { name: /Ask before each tool/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Bypass permission prompts/ })).not.toBeChecked();
    expect(screen.getByText(PERMISSION_HELP)).toBeInTheDocument();
    expect(PERMISSION_HELP).toBe(
      "Background tasks cannot answer permission prompts. Choose bypass only for a directory you trust.",
    );
  });

  it("does not commit bypass on the click — the confirmation does", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: /Bypass permission prompts/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("/work/trusted-repo");
    expect(onChange).not.toHaveBeenCalled();
    // `hidden` because the open dialog aria-hides the form behind it, which is the point of a
    // modal — the choice underneath is still on `ask` and has not moved.
    expect(screen.getByRole("radio", { name: /Ask before each tool/, hidden: true })).toBeChecked();
  });

  it("leaves the choice on ask when the confirmation is declined", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: /Bypass permission prompts/ }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Keep asking me" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /Ask before each tool/ })).toBeChecked();
  });

  it("commits bypass only after the confirmation is accepted", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: /Bypass permission prompts/ }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Bypass permission prompts" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("bypassPermissions");
    expect(await screen.findByRole("radio", { name: /Bypass permission prompts/ })).toBeChecked();
  });
});
