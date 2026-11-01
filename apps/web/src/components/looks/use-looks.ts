"use client";

import {
  FALLBACK_EFFECTS,
  FALLBACK_PALETTES,
  drawnYard,
  lookChangesFor,
  lookItemDigests,
  planSchedule,
  wledTimerDialect,
  type DrawnProp,
  type LastLookPush,
  type LookChange,
  type LookEffectInfo,
  type LookPaletteInfo,
  type LooksDocument,
  type Prop,
} from "@nightplot/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJson, postJson, putJson } from "@/lib/api";

export type LooksPayload = LooksDocument & {
  yard: {
    lights: { id: string; name: string }[];
    props: (Prop & { lightName: string })[];
    elements: { id: string; lightId: string; label: string; start: number; stop: number; lightName: string }[];
  };
  caption: string;
};

export type NowRow = {
  lightId: string;
  lightName: string;
  online: boolean;
  previewing: boolean;
  on: boolean | null;
  lookId: string | null;
  playlistId: string | null;
  preset: number | null;
  playlist: number | null;
  changes: LookChange[];
  lastSentAt: string | null;
};

export type LightLite = { id: string; name: string; firmware?: string | null; lastLookPush?: LastLookPush | null };

export type EffectCatalog = {
  source: "lights" | "built-in";
  effects: LookEffectInfo[];
  palettes: LookPaletteInfo[];
  missing: { fx: number; name: string; lights: string[] }[];
  caption: string;
};

export type SendRow = { lightId: string; lightName: string; status: string; detail: string; safetyBackupId?: string };

type Doc = Pick<LooksDocument, "looks" | "playlists" | "schedule" | "sectionColoursMigrated">;

/**
 * The Looks library as the page edits it. Every change saves to Nightplot a
 * moment later; nothing reaches a Light until Send.
 */
export function useLooks(initial: LooksPayload, lights: LightLite[]) {
  const [doc, setDocState] = useState<Doc>({
    looks: initial.looks, playlists: initial.playlists, schedule: initial.schedule,
    ...(initial.sectionColoursMigrated ? { sectionColoursMigrated: true as const } : {}),
  });
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [now, setNow] = useState<NowRow[] | null>(null);
  const [catalog, setCatalog] = useState<EffectCatalog>({
    source: "built-in", effects: [...FALLBACK_EFFECTS], palettes: [...FALLBACK_PALETTES], missing: [],
    caption: "WLED's usual list until a Light answers.",
  });
  const pending = useRef<Doc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const props = initial.yard.props;
  const drawn: DrawnProp[] = useMemo(() => drawnYard(props), [props]);
  const allPropIds = useMemo(() => props.map((prop) => prop.id), [props]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inFlight.current) await inFlight.current;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setSaveState("saving");
    inFlight.current = (async () => {
      const result = await putJson<LooksDocument>("/api/looks", next);
      if (result.ok) { setSaveState("saved"); setSaveError(null); }
      else { setSaveState("error"); setSaveError(result.data.message ?? "Nightplot did not save that."); }
    })();
    await inFlight.current;
    inFlight.current = null;
  }, []);

  const setDoc = useCallback((update: (doc: Doc) => Doc) => {
    setDocState((current) => {
      const next = update(current);
      if (next === current) return current;
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush(); }, 400);
      setSaveState("saving");
      return next;
    });
  }, [flush]);

  useEffect(() => {
    // A change still waiting to save: ask before the tab closes.
    const leave = (event: BeforeUnloadEvent) => { if (pending.current) { void flush(); event.preventDefault(); } };
    window.addEventListener("beforeunload", leave);
    return () => { window.removeEventListener("beforeunload", leave); };
  }, [flush]);

  const refreshNow = useCallback(async () => {
    try {
      const body = await fetchJson<{ rows: NowRow[] }>("/api/looks/now");
      setNow(body.rows);
    } catch {
      setNow((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    fetchJson<{ rows: NowRow[] }>("/api/looks/now").then((body) => setNow(body.rows)).catch(() => setNow([]));
    fetchJson<EffectCatalog>("/api/looks/effects").then(setCatalog).catch(() => undefined);
  }, [refreshNow]);

  const [sentNow, setSentNow] = useState<Record<string, LastLookPush | null>>({});
  const changesFor = useCallback((lightId: string): LookChange[] => {
    const light = lights.find((row) => row.id === lightId);
    const last = lightId in sentNow ? sentNow[lightId] : light?.lastLookPush ?? null;
    return lookChangesFor(doc, last);
  }, [doc, lights, sentNow]);

  const allChanges = useMemo(() => {
    const map = new Map<string, LookChange>();
    for (const light of lights) for (const change of changesFor(light.id)) map.set(change.key, change);
    return [...map.values()];
  }, [lights, changesFor]);

  const plan = useMemo(() => {
    if (!doc.schedule) return null;
    const dialect = wledTimerDialect(lights[0]?.firmware ?? null);
    return planSchedule(doc.schedule, doc, dialect);
  }, [doc, lights]);

  const send = useCallback(async (lightIds: string[]): Promise<{ rows: SendRow[]; message: string }> => {
    await flush();
    const includeSchedule = doc.schedule?.enabled === true;
    const result = await postJson<{ rows: SendRow[]; message: string }>("/api/looks/push", { lightIds, includeSchedule });
    if (!result.ok) return { rows: [], message: result.data.message ?? "Nothing was sent." };
    const digests = lookItemDigests(doc);
    setSentNow((current) => {
      const next = { ...current };
      for (const row of result.data.rows) {
        if (row.status !== "matched") continue;
        const items = { ...digests };
        if (!includeSchedule) delete items.schedule;
        next[row.lightId] = { at: new Date().toISOString(), includeSchedule, digest: "", items };
      }
      return next;
    });
    void refreshNow();
    return result.data;
  }, [doc, flush, refreshNow]);

  const undoSend = useCallback(async (rows: SendRow[]): Promise<string> => {
    const done: string[] = [];
    const failed: string[] = [];
    for (const row of rows) {
      if (!row.safetyBackupId) continue;
      const result = await postJson(`/api/backups/${row.safetyBackupId}/restore-wled`, { lightId: row.lightId, confirmId: row.safetyBackupId });
      (result.ok ? done : failed).push(row.lightName);
      if (result.ok) setSentNow((current) => ({ ...current, [row.lightId]: null }));
    }
    void refreshNow();
    if (failed.length) return `Put back ${done.length ? done.join(", ") : "nothing"}. ${failed.join(", ")} did not take its backup.`;
    return `Put back each Light's presets and timers from before the send (${done.join(", ")}). Each one restarts to load them.`;
  }, [refreshNow]);

  const turnOn = useCallback(async (slot: number): Promise<string> => {
    await flush();
    const result = await postJson<{ rows: SendRow[]; message: string }>("/api/looks/turn-on", { slot });
    void refreshNow();
    if (!result.ok) return result.data.message ?? "Nothing was turned on.";
    const off = result.data.rows.filter((row) => row.status !== "matched");
    return off.length ? `${result.data.message} ${off.map((row) => `${row.lightName}: ${row.detail}`).join(" ")}` : result.data.message;
  }, [flush, refreshNow]);

  return {
    doc, setDoc, flush, saveState, saveError,
    props, drawn, allPropIds,
    now, refreshNow, catalog,
    changesFor, allChanges, plan,
    send, undoSend, turnOn,
  };
}

export type LooksState = ReturnType<typeof useLooks>;
