import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { lightDetail } from "@/test/fixtures";
import { SettingsPanel } from "./settings-panel";

vi.mock("@/components/safe-settings", () => ({ SafeSettingsPanel: () => null }));
vi.mock("@/components/strip-provision", () => ({ StripProvisionPanel: () => null }));
vi.mock("@/components/delete-light", () => ({ DeleteLight: () => null }));
vi.mock("@/components/controller-replacement", () => ({ ControllerReplacement: () => null }));

function panel(detail = lightDetail()) {
  return <SettingsPanel detail={detail} addressOpen={false} addressHost="" addressSteps={null}
    addressBusy={false} onToggleAddress={vi.fn()} onHost={vi.fn()} onCheck={vi.fn()} onUpdated={vi.fn()} />;
}

describe("Light health panel", () => {
  it("shows known readings and a firmware compatibility warning", () => {
    const detail = lightDetail();
    detail.health = { uptimeSeconds: 91234, wifiSignalPercent: 75, wifiRssiDbm: -62,
      freeHeapBytes: 20480, compatibilityNotice: "Strip Apply is refused on old firmware." };
    render(panel(detail));
    expect(screen.getByText("1d 1h 20m")).toBeTruthy();
    expect(screen.getByText("75% · -62 dBm")).toBeTruthy();
    expect(screen.getByText("20.0 KiB")).toBeTruthy();
    expect(screen.getByText(/Strip Apply is refused/)).toBeTruthy();
  });

  it("does not show stale readings for an unreachable Light", () => {
    const detail = lightDetail();
    detail.health = null;
    detail.light.reachability = "no-answer";
    render(panel(detail));
    expect(screen.getByText(/Current health unavailable/)).toBeTruthy();
    expect(screen.queryByText(/KiB/)).toBeNull();
  });
});
