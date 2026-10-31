import type { ApplyResult, LightDetail } from "@nightplot/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddPropFlow } from "./add-prop";
import { lightDetail, lightView, requestPath } from "@/test/fixtures";

function detail(overrides: Partial<LightDetail> = {}): LightDetail {
  return lightDetail({
    light: lightView({
      name: "Garage",
      reachability: "online",
      on: true,
      brightness: 180,
      ledCount: 60,
    }),
    elements: [],
    props: [],
    ...overrides,
  });
}

function appliedWindow(): LightDetail & { apply: ApplyResult; prop: { label: string; kind: string } } {
  return {
    ...detail({
      elements: [
        { id: "t", lightId: "light-garage", label: "Front window · top", start: 0, stop: 11 },
        { id: "r", lightId: "light-garage", label: "Front window · right", start: 11, stop: 21 },
        { id: "b", lightId: "light-garage", label: "Front window · bottom", start: 21, stop: 31 },
        { id: "l", lightId: "light-garage", label: "Front window · left", start: 31, stop: 41 },
      ],
      props: [{
        id: "prop-1",
        lightId: "light-garage",
        label: "Front window",
        kind: "window",
        elementIds: ["t", "r", "b", "l"],
      }],
    }),
    apply: {
      status: "matched",
      matched: true,
      rows: [],
      sent: [],
      read: [],
      message: "Controller reports the ranges we sent.",
      caption: "Software-green from the fixture. Not Hardware Done.",
    },
    prop: { label: "Front window", kind: "window" },
  };
}

function renderFlow() {
  const writes: { path: string; body: unknown }[] = [];
  const applied = vi.fn();
  const closed = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (init?.method === "POST") writes.push({ path, body });
      if (path.endsWith("/props")) {
        return new Response(JSON.stringify(appliedWindow()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(detail()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  render(
    <AddPropFlow
      lightId="light-garage"
      lightName="Garage"
      ledCount={60}
      outputs={[]}
      existing={[]}
      props={[]}
      rgbw={false}
      unreachable={false}
      onClose={closed}
      onApplied={applied}
    />,
  );
  return { writes, applied, closed };
}

describe("Add prop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("walks a window template and Applies named sides without typing a count", async () => {
    const { writes, applied, closed } = renderFlow();
    const dialog = screen.getByRole("dialog", { name: "Add prop on Garage" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Window/ }));
    const name = within(dialog).getByLabelText("Prop name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Front window" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Walk the strip" }));

    for (const led of [0, 10, 20, 30, 40]) {
      if (led > 0) {
        fireEvent.click(within(dialog).getByRole("button", { name: "+10" }));
      }
      const mark = within(dialog).getByRole("button", { name: /^Mark / });
      fireEvent.click(mark);
      expect(within(dialog).getByText(new RegExp(`LED ${led}`))).toBeTruthy();
    }

    fireEvent.click(within(dialog).getByRole("button", { name: "Review this Prop" }));
    expect(within(dialog).getByText("Front window · top")).toBeTruthy();
    expect(within(dialog).getByText("Front window · left")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply this Prop" }));

    await waitFor(() => {
      expect(
        writes.some(
          (write) =>
            write.path.endsWith("/props") &&
            (write.body as { apply?: boolean; kind?: string }).apply === true &&
            (write.body as { kind?: string }).kind === "window",
        ),
      ).toBe(true);
    });
    const body = writes.find((write) => write.path.endsWith("/props"))?.body as {
      taps: { index: number }[];
      label: string;
    };
    expect(body.label).toBe("Front window");
    expect(body.taps.map((tap) => tap.index)).toEqual([0, 10, 20, 30, 40]);
    expect(applied).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it("opens a lock-only wireframe without drawing a line", async () => {
    const { writes } = renderFlow();
    const dialog = screen.getByRole("dialog", { name: "Add prop on Garage" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Wireframe/ }));
    fireEvent.change(within(dialog).getByLabelText("Prop name"), { target: { value: "Well house" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lock from the lit cursor" }));
    const overlay = screen.getByRole("dialog", { name: "Wireframe on Garage" });
    expect(within(overlay).getByLabelText("Lock role")).toBeTruthy();
    fireEvent.click(within(overlay).getByRole("button", { name: "Lock this corner" }));
    fireEvent.click(within(overlay).getByRole("button", { name: "Review this wireframe" }));
    fireEvent.click(within(overlay).getByRole("button", { name: "Apply this Prop" }));
    await waitFor(() => {
      expect(writes.some((write) => (
        write.path.endsWith("/props") &&
        (write.body as { kind?: string }).kind === "wireframe" &&
        (write.body as { apply?: boolean }).apply === true
      ))).toBe(true);
    });
    const body = writes.find((write) => write.path.endsWith("/props"))?.body as {
      kind: string;
      label: string;
      wireframe: { path: null | object; locks: { role: string }[] };
    };
    expect(body.label).toBe("Well house");
    expect(body.wireframe.path).toBeNull();
    expect(body.wireframe.locks.length).toBeGreaterThan(0);
  });

  it("keeps Review disabled until a window has five marks", () => {
    renderFlow();
    const dialog = screen.getByRole("dialog", { name: "Add prop on Garage" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Walk the strip" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Mark / }));
    expect((within(dialog).getByRole("button", { name: "Review this Prop" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
