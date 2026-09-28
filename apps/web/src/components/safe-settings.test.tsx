import type { LightDetail as LightDetailPayload, SafeRead } from "@nightplot/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SafeSettingsPanel } from "@/components/safe-settings";
import { lightDetail, lightView, requestPath } from "@/test/fixtures";

const CFG_MISMATCH_MESSAGE =
  "Wrote, but /json/cfg did not match. Not treating as success.";
const BUILD_REFUSE_MESSAGE =
  "This firmware’s config isn’t a shape we write. Nothing was sent.";
const NOTICE_ONLY_MESSAGE = "Send { settings } with Safe settings fields.";
const MATCHED_MESSAGE = "Controller reports the Safe settings we sent.";

const safe: SafeRead = {
  settings: {
    displayName: "WLED",
    turnOnAtBoot: true,
    bootBrightness: 128,
    bootPreset: 0,
    defaultTransition: 7,
    currentLimitMa: 850,
  },
  fingerprint: {
    firmware: "WLED 0.15.4",
    source: "cfg",
    writable: true,
    fields: [
      "displayName",
      "turnOnAtBoot",
      "bootBrightness",
      "bootPreset",
      "defaultTransition",
      "currentLimitMa",
    ],
  },
  caption: "Software-green from the fixture. Not Hardware Done.",
  refuse: null,
};

function payload(
  overrides: Partial<Omit<LightDetailPayload, "safe">> & { safe?: SafeRead } = {},
): LightDetailPayload & { safe: SafeRead } {
  return {
    ...lightDetail({
      light: lightView({
        reachability: "online",
        on: true,
        brightness: 128,
        bead: "#ffa000",
      }),
    }),
    ...overrides,
    safe: overrides.safe ?? safe,
  };
}

function mockSafeFetch(writeBody: Record<string, unknown>, status = 422) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = requestPath(String(input));
    if (path.endsWith("/safe") && init?.method === "POST") {
      return new Response(JSON.stringify(writeBody), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path.endsWith("/safe")) {
      return new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "unexpected path" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("Safe settings", () => {
  it("titles a buildSafeWrite refuse from safeWrite — failure panel, not a doubled notice", async () => {
    const fetch = mockSafeFetch({
      ...payload(),
      safeWrite: {
        status: "refused",
        matched: false,
        sent: { displayName: "Porch rail" },
        read: safe.settings,
        fingerprint: safe.fingerprint,
        message: BUILD_REFUSE_MESSAGE,
        caption: safe.caption,
      },
      message: BUILD_REFUSE_MESSAGE,
    });
    vi.stubGlobal("fetch", fetch);

    render(<SafeSettingsPanel lightId="light-garage" unreachable={false} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Device display name" }), {
      target: { value: "Porch rail" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Apply settings" }));

    const titles = await screen.findAllByText(BUILD_REFUSE_MESSAGE);
    expect(titles).toHaveLength(1);
    expect(titles[0]?.tagName).toBe("SPAN");
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(screen.getByText(/display name Porch rail/)).toBeTruthy();
    expect(screen.getByText("Read back")).toBeTruthy();
    expect(screen.getByText(/display name WLED/)).toBeTruthy();
    expect(screen.getAllByText(/Not Hardware Done/)).toHaveLength(1);
  });

  it("keeps a write→reread mismatch on the failure UI and hides notice", async () => {
    const fetch = mockSafeFetch(
      {
        ...payload(),
        safeWrite: {
          status: "mismatch",
          matched: false,
          sent: { displayName: "Porch rail" },
          read: safe.settings,
          fingerprint: safe.fingerprint,
          message: CFG_MISMATCH_MESSAGE,
          caption: safe.caption,
        },
        message: CFG_MISMATCH_MESSAGE,
      },
      409,
    );
    vi.stubGlobal("fetch", fetch);

    render(<SafeSettingsPanel lightId="light-garage" unreachable={false} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Device display name" }), {
      target: { value: "Porch rail" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Apply settings" }));

    const titles = await screen.findAllByText(CFG_MISMATCH_MESSAGE);
    expect(titles).toHaveLength(1);
    expect(titles[0]?.tagName).toBe("SPAN");
    expect(titles[0]?.textContent).not.toMatch(/didn’t stick/);
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(screen.getByText(/display name Porch rail/)).toBeTruthy();
    expect(screen.getByText("Read back")).toBeTruthy();
    expect(screen.queryByText(BUILD_REFUSE_MESSAGE)).toBeNull();
    expect(screen.getAllByText(/Not Hardware Done/)).toHaveLength(1);
  });

  it("still shows a notice-only miss when the body has no safeWrite", async () => {
    const fetch = mockSafeFetch({
      error: "invalid",
      message: NOTICE_ONLY_MESSAGE,
    });
    vi.stubGlobal("fetch", fetch);

    render(<SafeSettingsPanel lightId="light-garage" unreachable={false} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Device display name" }), {
      target: { value: "Porch rail" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Apply settings" }));

    const notice = await screen.findByText(NOTICE_ONLY_MESSAGE);
    expect(notice.tagName).toBe("P");
    expect(screen.queryByText("Sent")).toBeNull();
    expect(screen.queryByText("Read back")).toBeNull();
    expect(screen.getByText(/Not Hardware Done/)).toBeTruthy();
  });

  it("shows a load-path refuse once — banner, not a doubled notice", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(String(input));
      if (path.endsWith("/safe") && init?.method !== "POST") {
        return new Response(
          JSON.stringify(
            payload({
              safe: {
                ...safe,
                fingerprint: { ...safe.fingerprint, writable: false, fields: [] },
                refuse: BUILD_REFUSE_MESSAGE,
              },
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ message: "unexpected path" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<SafeSettingsPanel lightId="light-garage" unreachable={false} />);

    const lines = await screen.findAllByText(BUILD_REFUSE_MESSAGE);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.tagName).toBe("P");
    expect(lines[0]?.className).toMatch(/font-semibold/);
    expect(screen.getAllByText(/Not Hardware Done/)).toHaveLength(1);
    expect(screen.queryByText("Sent")).toBeNull();
    expect(screen.queryByText("Read back")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.getAllByText(BUILD_REFUSE_MESSAGE)).toHaveLength(1);
    expect(screen.getAllByText(/Not Hardware Done/)).toHaveLength(1);
  });

  it("shows a successful load caption once — no refuse notice", async () => {
    vi.stubGlobal("fetch", mockSafeFetch({}));

    render(<SafeSettingsPanel lightId="light-garage" unreachable={false} />);

    expect(await screen.findByRole("button", { name: "Apply settings" })).toBeTruthy();
    expect(screen.getAllByText(/Not Hardware Done/)).toHaveLength(1);
    expect(screen.queryByText(BUILD_REFUSE_MESSAGE)).toBeNull();
    expect(screen.queryByText("Sent")).toBeNull();
  });

  it("shows a matched write once — no Sent/Read panel", async () => {
    const fetch = mockSafeFetch(
      {
        ...payload(),
        safeWrite: {
          status: "matched",
          matched: true,
          sent: { displayName: "Porch rail" },
          read: { ...safe.settings, displayName: "Porch rail" },
          fingerprint: safe.fingerprint,
          message: MATCHED_MESSAGE,
          caption: safe.caption,
        },
      },
      200,
    );
    vi.stubGlobal("fetch", fetch);

    render(<SafeSettingsPanel lightId="light-garage" unreachable={false} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Device display name" }), {
      target: { value: "Porch rail" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Apply settings" }));

    const line = await screen.findByText(MATCHED_MESSAGE);
    expect(line.tagName).toBe("P");
    expect(screen.queryByText("Sent")).toBeNull();
    expect(screen.queryByText("Read back")).toBeNull();
    expect(screen.queryByText(BUILD_REFUSE_MESSAGE)).toBeNull();
    expect(screen.queryByText(CFG_MISMATCH_MESSAGE)).toBeNull();
  });

  it("applies only the changed controller display name, not other Safe settings", async () => {
    const fetch = mockSafeFetch(
      {
        ...payload(),
        safeWrite: {
          status: "matched",
          matched: true,
          sent: { displayName: "Porch rail" },
          read: { ...safe.settings, displayName: "Porch rail" },
          fingerprint: safe.fingerprint,
          message: MATCHED_MESSAGE,
          caption: safe.caption,
        },
      },
      200,
    );
    vi.stubGlobal("fetch", fetch);

    render(<SafeSettingsPanel lightId="light-garage" unreachable={false} />);
    const apply = await screen.findByRole("button", { name: "Apply settings" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Device display name" }), {
      target: { value: "Porch rail" },
    });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(apply);

    await screen.findByText(MATCHED_MESSAGE);
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ settings: { displayName: "Porch rail" } });
  });
});
