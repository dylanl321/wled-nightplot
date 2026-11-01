import { describe, expect, it } from "vitest";
import { estimateLabelWidth, placeYardLabels, type YardLabelAnchor, type YardLabelSlot } from "./yard-labels";

function anchor(id: string, x: number, y: number, text: string): YardLabelAnchor {
  return { id, x, y, text };
}

function boxesOverlap(a: YardLabelSlot, b: YardLabelSlot): boolean {
  const gap = 4;
  const height = 16;
  return a.x < b.x + b.width + gap
    && a.x + a.width + gap > b.x
    && a.y < b.y + height + gap
    && a.y + height + gap > b.y;
}

function hits(slot: YardLabelSlot, box: { x: number; y: number; w: number; h: number }): boolean {
  return slot.x < box.x + box.w && slot.x + slot.width > box.x && slot.y < box.y + box.h && slot.y + 16 > box.y;
}

describe("yard name labels", () => {
  it("centres a lone label just above its prop", () => {
    const text = "Porch · 40 lights";
    const width = Math.min(188, estimateLabelWidth(text));
    const [slot] = placeYardLabels([anchor("a", 200, 100, text)]);
    expect(slot).toMatchObject({ text, y: 78, width });
    expect(slot!.x).toBeCloseTo(200 - width / 2);
  });

  it("keeps close props from sharing one caption", () => {
    const slots = placeYardLabels([
      anchor("a", 100, 80, "Front roof · 122 lights"),
      anchor("b", 140, 80, "Garage gable · 80 lights"),
      anchor("c", 180, 84, "Porch columns · 60 lights"),
    ]);
    expect(slots).toHaveLength(3);
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        expect(boxesOverlap(slots[i]!, slots[j]!)).toBe(false);
      }
      expect(slots[i]!.text.length).toBeGreaterThan(3);
    }
  });

  it("leaves labels that already clear each other on their own spots", () => {
    const slots = placeYardLabels([
      anchor("a", 80, 100, "Porch · 10 lights"),
      anchor("b", 520, 100, "Shed · 10 lights"),
    ]);
    expect(slots.every((slot) => slot.y === 78)).toBe(true);
    expect(slots.every((slot) => slot.text.endsWith("lights"))).toBe(true);
  });

  it("shows the full name for the prop under the pointer or the selection", () => {
    const text = "Front roof · 122 lights";
    const slots = placeYardLabels([
      anchor("a", 100, 80, text),
      anchor("b", 130, 80, "Garage gable · 80 lights"),
    ], { expandedId: "a" });
    expect(slots.find((slot) => slot.id === "a")!.text).toBe(text);
    expect(boxesOverlap(slots[0]!, slots[1]!)).toBe(false);
  });

  it("stays off the zoom buttons", () => {
    const [slot] = placeYardLabels(
      [anchor("a", 360, 40, "Front roof · 122 lights")],
      { stage: { w: 400, h: 320 } },
    );
    expect(hits(slot!, { x: 340, y: 0, w: 60, h: 168 })).toBe(false);
    expect(slot!.text.length).toBeGreaterThan(3);
  });
});
