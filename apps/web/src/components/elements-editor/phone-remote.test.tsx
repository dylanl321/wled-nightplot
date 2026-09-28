import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PhoneRemote } from "./phone-remote";

describe("phone Locate remote", () => {
  it("shows one LED and Preview controls, without Segment editing or Apply", () => {
    const step = vi.fn();
    const preview = vi.fn();
    const close = vi.fn();
    render(<PhoneRemote lightName="Garage" ledCount={60} cursor={0} live={false} blocked={false}
      stopping={false} error={null} onStep={step} onPreview={preview} onEnd={vi.fn()} onClose={close} />);

    const remote = screen.getByRole("dialog", { name: "Garage phone remote" });
    expect(within(remote).getByText("of 59")).toBeTruthy();
    expect((within(remote).getByRole("button", { name: "Previous LED" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(remote).getByRole("button", { name: "Next LED" }));
    expect(step).toHaveBeenCalledWith(1);
    fireEvent.click(within(remote).getByRole("button", { name: "Start Preview" }));
    expect(preview).toHaveBeenCalledOnce();
    expect(within(remote).queryByRole("button", { name: /Apply|Save/ })).toBeNull();
    fireEvent.keyDown(remote, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps End Preview explicit and refuses movement during cleanup", () => {
    const end = vi.fn();
    render(<PhoneRemote lightName="Garage" ledCount={60} cursor={59} live blocked={false}
      stopping={false} error={null} onStep={vi.fn()} onPreview={vi.fn()} onEnd={end} onClose={vi.fn()} />);
    const remote = screen.getByRole("dialog", { name: "Garage phone remote" });
    expect((within(remote).getByRole("button", { name: "Next LED" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(remote).getByRole("button", { name: "End Preview" }));
    expect(end).toHaveBeenCalledOnce();
    expect(within(remote).getByRole("button", { name: "End Preview & return" })).toBeTruthy();
  });

  it("returns keyboard focus to the Segments control when the remote closes", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<PhoneRemote lightName="Garage" ledCount={60} cursor={5} live={false}
      blocked={false} stopping={false} error={null} onStep={vi.fn()} onPreview={vi.fn()}
      onEnd={vi.fn()} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Return to Segments" }));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
