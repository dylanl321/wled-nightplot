import { describe, expect, it } from "vitest";
import { approximateWledColours, lookFrame, yardLiveColour } from "./look-preview.ts";
import type { Look } from "./look.ts";
import type { PropLayout } from "./prop/layout.ts";
import type { Prop } from "./prop/types.ts";

const style = { fx: 0, pal: 0, sx: 128, ix: 128, bri: 255, color: "#ff0000" };

function look(extra?: Partial<Look>): Look {
  return { id: "look", name: "Red", slot: 1, style, overrides: [], ...extra };
}

const line: PropLayout = {
  source: "template",
  units: "m",
  pitchM: 0.1,
  startOffsetM: 0,
  corners: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }],
  run: [{ id: "e1", from: "a", to: "b", kind: "lit" }],
};

function prop(extra?: Partial<Prop>): Prop {
  return { id: "roof", label: "Roof", kind: "roofline", elementIds: [], layout: line, ...extra };
}

describe("Look preview", () => {
  it("paints a solid colour, and leaves a prop out of the Look dark", () => {
    const frame = lookFrame({ look: look(), props: [prop()], t: 0 });
    expect(frame).toHaveLength(10);
    expect(frame.every((light) => light.color === "#ff0000")).toBe(true);
    const dark = lookFrame({ look: look({ propIds: [] }), props: [prop()], t: 0 });
    expect(dark.every((light) => light.color === "#000000")).toBe(true);
  });

  it("uses a section's own style, and a breathe frame changes with time", () => {
    const sectioned = prop({
      sections: [{ id: "top", name: "Top", edgeIds: ["e1"], pinnedRanges: [], color: "#00ff00" }],
    });
    const base = look();
    const withSection = { ...base, overrides: [...base.overrides, { propId: sectioned.id, sectionId: "top", style: { ...base.style, color: "#00ff00" } }] };
    const frame = lookFrame({ look: withSection, props: [sectioned], t: 0 });
    expect(frame[0]?.color).toBe("#00ff00");
    const breathe = { ledCount: 1, on: true, brightness: 255, fx: 2, pal: 0, speed: 128, intensity: 128, color: "#ff0000" };
    const dim = approximateWledColours({ ...breathe, elapsedMs: 0 });
    const full = approximateWledColours({ ...breathe, elapsedMs: 700 });
    expect(dim[0]).not.toBe(full[0]);
    expect(approximateWledColours({ ...breathe, ledCount: 4, on: false, elapsedMs: 0 })).toEqual(["#000000", "#000000", "#000000", "#000000"]);
  });

  it("is the same frame twice, and a rainbow is not one colour", () => {
    const rainbow = { ledCount: 8, on: true, brightness: 255, fx: 9, pal: 11, speed: 40, intensity: 128, color: "#ff0000", elapsedMs: 0 };
    const once = approximateWledColours(rainbow);
    const twice = approximateWledColours(rainbow);
    expect(twice).toEqual(once);
    expect(new Set(once).size).toBeGreaterThan(1);
  });

  it("uses a live read when one exists, and does not invent one when it does not", () => {
    const shared = {
      propId: "roof",
      stringId: "s1",
      index: 2,
      props: [prop()],
      attachments: [{ propId: "roof", lightId: "light", outputId: "out", startIndex: 5, afterPropId: null }],
      outputs: [{ lightId: "light", outputId: "out", start: 10 }],
    };
    const leds = Array.from({ length: 20 }, () => "#111111");
    leds[17] = "#00ff00";
    expect(yardLiveColour({ ...shared, feed: [{ lightId: "light", leds }] })).toBe("#00ff00");
    expect(yardLiveColour({ ...shared, feed: [{ lightId: "light", leds: null }] })).toBeNull();
    expect(yardLiveColour({ ...shared, feed: [] })).toBeNull();
  });
});
