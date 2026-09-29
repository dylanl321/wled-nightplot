"use client";

import { estimatePowerScenario, type LightDetail, type SafeRead, type SegmentPowerColour } from "@nightplot/shared";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/api";

/** User-controlled planning colours: never represented as observed WLED current. */
export function PowerBudgetPanel({ detail }: { detail: LightDetail }) {
  const [colours, setColours] = useState<Record<string, SegmentPowerColour>>({});
  const [brightness, setBrightness] = useState(detail.light.brightness ?? 255);
  const [limit, setLimit] = useState<number | null>(null);
  const [limitNote, setLimitNote] = useState("Reading Safe current limit…");
  const light = detail.light;

  useEffect(() => {
    let active = true;
    setLimit(null);
    setLimitNote("Reading Safe current limit…");
    void fetchJson<{ safe: SafeRead }>(`/api/lights/${light.id}/safe`)
      .then((payload) => {
        if (!active) return;
        const value = payload.safe?.settings.currentLimitMa;
        setLimit(typeof value === "number" ? value : null);
        setLimitNote(typeof value === "number" ? value === 0 ? "WLED current limiter is disabled." : "WLED Safe current limit (not a power-supply rating)." : "Safe current limit was not reported.");
      })
      .catch(() => { if (active) setLimitNote("Safe current limit unavailable; controller may be unreachable."); });
    return () => { active = false; };
  }, [light.id]);

  const scenario = estimatePowerScenario({ segments: detail.elements, ledCount: light.ledCount,
    stripKind: light.stripKind, brightness, limitMa: limit,
    colours: Object.fromEntries(detail.elements.map((segment) => [segment.id,
      colours[segment.id] ?? { hex: "#ffffff", white: 0 }])),
  });
  const rgbw = light.stripKind === "sk6812-rgbw";
  return <div className="space-y-4 text-[13px]">
    <p className="text-muted-foreground">Planning estimate only: choose a colour for each saved Segment. White starts at full RGB and RGBW’s separate white channel starts at zero. These are not live WLED colours or measured amps.</p>
    <label className="flex items-center gap-3">Scenario brightness (0–255)
      <Input className="w-24" type="number" min={0} max={255} value={brightness}
        onChange={(event) => setBrightness(Number(event.target.value))} aria-label="Scenario brightness" />
    </label>
    {detail.elements.length === 0 ? <p>No saved Segments to estimate.</p> : null}
    {detail.elements.map((segment) => {
      const colour = colours[segment.id] ?? { hex: "#ffffff", white: 0 };
      const row = scenario?.rows.find((item) => item.id === segment.id);
      return <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3" key={segment.id}>
        <span className="min-w-32">{segment.label} · {segment.stop - segment.start} LEDs</span>
        <label className="flex items-center gap-2">Colour <input aria-label={`${segment.label} colour`} type="color" value={colour.hex}
          onChange={(event) => setColours((current) => ({ ...current, [segment.id]: { ...colour, hex: event.target.value } }))} /></label>
        {rgbw ? <label className="flex items-center gap-2">White channel <Input className="w-20" type="number" min={0} max={255}
          aria-label={`${segment.label} white channel`} value={colour.white}
          onChange={(event) => setColours((current) => ({ ...current, [segment.id]: { ...colour, white: Number(event.target.value) } }))} /></label> : null}
        <span className="ml-auto tabular-nums">{row ? `≈ ${Math.round(row.milliAmps)} mA` : "Cannot estimate"}</span>
      </div>;
    })}
    {!scenario ? <p role="status">Cannot estimate: check Segment ranges, driver and scenario values.</p> : <div className="space-y-1 rounded-lg bg-secondary p-3">
      <p>Saved Segments at chosen colours: ≈ {Math.round(scenario.totalMa)} mA</p>
      <p>{limitNote} {scenario.limitMa === null ? "No comparison available." : `${scenario.limitMa} mA configured.`}</p>
      {scenario.aboveLimit === true ? <p className="text-amber-200">This scenario exceeds the configured WLED current limit before WLED’s limiter acts.</p> : null}
      {scenario.aboveLimit === false ? <p>Below the configured WLED limit in this model; not proof of a safe power supply.</p> : null}
      {scenario.uncoveredLeds > 0 ? <p>{scenario.uncoveredLeds} LEDs are outside saved Segments and are not included.</p> : null}
    </div>}
    <p className="text-[12px] text-muted-foreground">Model: up to 20 mA per RGB channel per LED, plus up to 20 mA for RGBW white, scaled by selected brightness. Effects, real LED variation, controller overhead, voltage drop and wiring are not measured. Do not use this as a fuse or supply rating.</p>
  </div>;
}
