import { describe, expect, it } from "vitest";
import { encodeDdpRgb, parseDdpRgb, rgbFill } from "./wled-ddp.ts";

describe("DDP RGB framing", () => {
  it("round-trips offset and RGB payload", () => {
    const rgb = rgbFill(3, 255, 0, 64);
    const packet = encodeDdpRgb(rgb, 9);
    const parsed = parseDdpRgb(packet);
    expect(parsed?.offsetBytes).toBe(9);
    expect([...parsed!.rgb]).toEqual([...rgb]);
  });

  it("rejects a truncated header", () => {
    expect(parseDdpRgb(Buffer.from([0x41, 0x00, 0x01]))).toBeNull();
  });
});
