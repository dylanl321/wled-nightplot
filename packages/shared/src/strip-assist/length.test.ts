import { describe, expect, it } from "vitest";
import {
  FIND_LENGTH_ANSWERS_FOR_1K,
  FIND_LENGTH_DIM,
  FIND_LENGTH_END,
  FIND_LENGTH_OFF,
  answerLitToEnd,
  beginSearch,
  confirmableLength,
  findLengthCaption,
  findLengthCeilingChoices,
  findLengthConfirmDraft,
  findLengthExpandChoices,
  findLengthRestoreDraft,
  findLengthSpans,
  findLengthWriteBody,
  isolatedLength,
  needsCeilingWrite,
  needsLongerCeiling,
  nudgeFindLength,
  startFindLength,
  worstCaseHalvingAnswers,
} from "./length.ts";
import { getStripAssistPlugin, listStripAssistPlugins } from "./catalog.ts";

function session(currentLength: number, extra?: { outputIndex?: number; outputStart?: number }) {
  return startFindLength({
    outputIndex: extra?.outputIndex ?? 0,
    outputStart: extra?.outputStart ?? 0,
    currentLength,
    ledType: "ws281x",
    gpio: 16,
  });
}

function isolate(secret: number, ceiling: number) {
  let state = beginSearch(session(ceiling), ceiling);
  while (isolatedLength(state) === null && !needsLongerCeiling(state) && state.answers < 40) {
    state = answerLitToEnd(state, secret <= state.candidate);
  }
  return state;
}

describe("strip-assist catalog", () => {
  it("registers Find length and leaves a segment helper unregistered", () => {
    expect(listStripAssistPlugins().map((entry) => entry.id)).toEqual(["find-length"]);
    expect(getStripAssistPlugin("find-length")?.kind).toBe("length");
    expect(getStripAssistPlugin("find-length")?.wired).toBe(false);
    expect(getStripAssistPlugin("segment")).toBeUndefined();
  });
});

describe("find length search", () => {
  it("starts on the ceiling picker and searches within the current length without a write", () => {
    const started = session(60);
    expect(started.phase).toBe("pick-ceiling");
    expect(needsCeilingWrite(started.originalLength, 60)).toBe(false);
    expect(findLengthCeilingChoices(60)).toEqual([60, 150, 300, 600, 1000, 2000, 2048]);
    const search = beginSearch(started, 60);
    expect(search.phase).toBe("search");
    expect(search.expanded).toBe(false);
    expect(search.candidate).toBe(60);
  });

  it("marks a longer ceiling as a lasting write for that output only", () => {
    const started = session(30);
    expect(needsCeilingWrite(started.originalLength, 1000)).toBe(true);
    const search = beginSearch(started, 1000);
    expect(search.expanded).toBe(true);
    expect(search.originalLength).toBe(30);
    expect(findLengthRestoreDraft(search)).toEqual({
      index: 0,
      ledType: "ws281x",
      length: 30,
      gpio: 16,
    });
    expect(findLengthWriteBody(findLengthRestoreDraft(search))).toEqual({
      provision: { outputs: [{ index: 0, ledType: "ws281x", length: 30, gpio: 16 }] },
    });
  });

  it("halves until the secret length is isolated", () => {
    const found = isolate(300, 1000);
    expect(needsLongerCeiling(found)).toBe(false);
    expect(isolatedLength(found)).toBe(300);
    expect(found.candidate).toBe(300);
    expect(found.answers).toBeLessThanOrEqual(FIND_LENGTH_ANSWERS_FOR_1K);
  });

  it("isolates every length on a 64-LED output, and a 1,000-LED run in 12 answers", () => {
    for (let secret = 1; secret <= 64; secret += 1) {
      const found = isolate(secret, 64);
      expect(isolatedLength(found)).toBe(secret);
    }
    expect(worstCaseHalvingAnswers(1000)).toBeLessThanOrEqual(FIND_LENGTH_ANSWERS_FOR_1K);
    const thousand = isolate(1000, 1000);
    expect(isolatedLength(thousand)).toBe(1000);
    expect(thousand.answers).toBeLessThanOrEqual(FIND_LENGTH_ANSWERS_FOR_1K);
    const one = isolate(1, 1000);
    expect(isolatedLength(one)).toBe(1);
    expect(one.answers).toBeLessThanOrEqual(FIND_LENGTH_ANSWERS_FOR_1K);
  });

  it("asks for a longer ceiling when the physical end stays dark at the current max", () => {
    let state = beginSearch(session(30), 30);
    state = answerLitToEnd(state, false);
    expect(needsLongerCeiling(state)).toBe(true);
    expect(findLengthExpandChoices(30)).toEqual([150, 300, 600, 1000, 2000, 2048]);
    const expanded = beginSearch(state, 300);
    expect(expanded.expanded).toBe(true);
    expect(expanded.originalLength).toBe(30);
    expect(expanded.candidate).toBe(300);
    expect(expanded.answers).toBe(0);
  });

  it("nudges by 1, 10, and 50 inside the ceiling", () => {
    let state = beginSearch(session(80), 80);
    state = nudgeFindLength(state, -50);
    expect(state.candidate).toBe(30);
    state = nudgeFindLength(state, 10);
    expect(state.candidate).toBe(40);
    state = nudgeFindLength(state, -1);
    expect(state.candidate).toBe(39);
    state = nudgeFindLength(state, 50);
    expect(state.candidate).toBe(80);
    state = nudgeFindLength(state, 50);
    expect(state.candidate).toBe(80);
  });

  it("paints only the chosen output and highlights its last candidate LED", () => {
    const state = beginSearch(session(40, { outputIndex: 1, outputStart: 60 }), 40);
    expect(findLengthSpans(state, 100)).toEqual([
      { start: 0, stop: 60, color: FIND_LENGTH_OFF },
      { start: 60, stop: 99, color: FIND_LENGTH_DIM },
      { start: 99, stop: 100, color: FIND_LENGTH_END },
    ]);
    expect(findLengthCaption(state, "Eave")).toBe(
      "Find length on Eave · lighting 40 LEDs. Preview is temporary.",
    );
    const shorter = nudgeFindLength(state, -10);
    expect(findLengthSpans(shorter, 100)).toEqual([
      { start: 0, stop: 60, color: FIND_LENGTH_OFF },
      { start: 60, stop: 89, color: FIND_LENGTH_DIM },
      { start: 89, stop: 90, color: FIND_LENGTH_END },
      { start: 90, stop: 100, color: FIND_LENGTH_OFF },
    ]);
    expect(confirmableLength(shorter)).toBe(30);
    expect(findLengthConfirmDraft(shorter)).toEqual({
      index: 1,
      ledType: "ws281x",
      length: 30,
      gpio: 16,
    });
  });
});
