"use client";

import type { Look, LookChange, LookStyle } from "@nightplot/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { postJson } from "@/lib/api";
import type { LightLite, NowRow, SendRow } from "./use-looks";

export function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    ref.current?.querySelector<HTMLElement>("input, select, button.primary, button")?.focus();
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  return (
    <div className="scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={label} ref={ref}>{children}</div>
    </div>
  );
}

export type Captured = { style: LookStyle; props: { propId: string; off: boolean; style: LookStyle | null }[]; message: string };

export function CaptureDialog({ lights, now, onClose, onCaptured }: {
  lights: LightLite[]; now: NowRow[] | null; onClose: () => void; onCaptured: (captured: Captured) => void;
}) {
  const [pick, setPick] = useState(lights[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog label="Start from a Light" onClose={onClose}>
      <h2>Start from what a Light shows</h2>
      <p className="note">If you set a Light up in the WLED app, Nightplot can read its segments and copy each prop&apos;s effect and colours into this Look.</p>
      {lights.map((light) => {
        const row = now?.find((item) => item.lightId === light.id);
        return (
          <label className="check" key={light.id}>
            <input type="radio" name="cap" checked={pick === light.id} onChange={() => setPick(light.id)} />{light.name}
            <span className="note" style={{ marginLeft: "auto" }}>{!row ? "" : !row.online ? "didn't answer" : row.previewing ? "showing a Preview" : row.preset ? `running preset ${row.preset}` : "running"}</span>
          </label>
        );
      })}
      {error ? <p className="warnnote">{error}</p> : null}
      <div className="btnrow"><span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={!pick || busy} onClick={async () => {
          setBusy(true); setError(null);
          const result = await postJson<Captured>("/api/looks/capture", { lightId: pick });
          setBusy(false);
          if (!result.ok) { setError(result.data.message ?? "Nothing was read."); return; }
          onCaptured(result.data);
        }}>{busy ? "Reading…" : "Copy into this Look"}</button>
      </div>
    </Dialog>
  );
}

export function NewLookDialog({ looks, onClose, onMake }: {
  looks: Look[]; onClose: () => void; onMake: (how: "on" | "off" | "copy", sourceId: string | null) => void;
}) {
  const [how, setHow] = useState<"on" | "off" | "copy">("on");
  const [source, setSource] = useState(looks[0]?.id ?? "");
  return (
    <Dialog label="New Look" onClose={onClose}>
      <h2>New Look</h2>
      <p className="note">Start from</p>
      <label className="check"><input type="radio" name="start" checked={how === "on"} onChange={() => setHow("on")} />Every prop on, warm white</label>
      <label className="check"><input type="radio" name="start" checked={how === "off"} onChange={() => setHow("off")} />Every prop off</label>
      {looks.length ? (
        <label className="check"><input type="radio" name="start" checked={how === "copy"} onChange={() => setHow("copy")} />A copy of
          <select className="in" aria-label="Look to copy" value={source} style={{ width: "auto", marginLeft: 6 }} onChange={(event) => { setSource(event.target.value); setHow("copy"); }}>
            {looks.map((look) => <option key={look.id} value={look.id}>{look.name}</option>)}
          </select>
        </label>
      ) : null}
      <div className="btnrow"><span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" onClick={() => onMake(how, how === "copy" ? source : null)}>Make it</button>
      </div>
    </Dialog>
  );
}

export function AddToLooksDialog({ propLabel, looks, isIn, onClose, onAdd }: {
  propLabel: string; looks: Look[]; isIn: (look: Look) => boolean; onClose: () => void; onAdd: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  return (
    <Dialog label="Add to Looks" onClose={onClose}>
      <h2>Add {propLabel} to Looks</h2>
      <p className="note">{propLabel} will follow each Look&apos;s style. You can give it its own colours in the Look afterwards.</p>
      <div>
        {looks.map((look) => {
          const already = isIn(look);
          return (
            <label className="check" key={look.id}>
              <input type="checkbox" disabled={already} checked={already || picked.has(look.id)}
                onChange={(event) => setPicked((set) => { const next = new Set(set); if (event.target.checked) next.add(look.id); else next.delete(look.id); return next; })} />
              {look.name}{already ? <span className="note" style={{ marginLeft: "auto" }}>already in</span> : null}
            </label>
          );
        })}
      </div>
      <div className="btnrow">
        <button type="button" className="btn small" onClick={() => setPicked(new Set(looks.filter((look) => !isIn(look)).map((look) => look.id)))}>Tick all</button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={picked.size === 0} onClick={() => onAdd([...picked])}>Add</button>
      </div>
    </Dialog>
  );
}

const KIND_COPY: Record<LookChange["kind"], string> = { new: "new", changed: "changed", deleted: "deleted" };

export function SendDialog({ lights, now, changesFor, allChanges, scheduleBlocked, onSend, onUndo, onClose }: {
  lights: LightLite[];
  now: NowRow[] | null;
  changesFor: (lightId: string) => LookChange[];
  allChanges: LookChange[];
  scheduleBlocked: string | null;
  onSend: (lightIds: string[]) => Promise<{ rows: SendRow[]; message: string }>;
  onUndo: (rows: SendRow[]) => Promise<string>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(lights.filter((light) => changesFor(light.id).length > 0).map((light) => light.id)));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ rows: SendRow[]; message: string } | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  if (result) {
    const bad = result.rows.filter((row) => row.status !== "matched");
    return (
      <Dialog label="Send results" onClose={onClose}>
        <h2>Sent</h2>
        {result.rows.length === 0 ? <p className="warnnote">{result.message}</p> : null}
        {result.rows.map((row) => (
          <div className="resrow" key={row.lightId}>
            <b>{row.lightName}</b>
            <span className={`st ${row.status === "matched" ? "ok" : "bad"}`}>{row.status === "matched" ? "Up to date" : row.status === "failed" || row.status === "refused" ? "Not sent" : "Not confirmed"}</span>
            <span className="why">{row.detail}</span>
          </div>
        ))}
        {bad.length ? <p className="note">A Light that didn&apos;t get it shows “not sent” on the Looks page. Send again when it&apos;s back.</p> : null}
        {result.rows.some((row) => row.safetyBackupId) ? <p className="note">Each Light&apos;s previous presets and timers were backed up first.</p> : null}
        {undo ? <p className="note" role="status">{undo}</p> : null}
        <div className="btnrow">
          {result.rows.some((row) => row.safetyBackupId) && !undo ? (
            <button type="button" className="btn" disabled={busy} onClick={async () => { setBusy(true); setUndo(await onUndo(result.rows)); setBusy(false); }}>{busy ? "Putting back…" : "Undo send"}</button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog label="Send to lights" onClose={onClose}>
      <h2>Send to the lights</h2>
      {allChanges.length ? (
        <div><h2 className="cap">What changes</h2>
          {allChanges.map((change) => <div className="resrow" key={change.key}><span>{change.name}</span><span className="note">{KIND_COPY[change.kind]}</span></div>)}
        </div>
      ) : <p className="note">Every Light already has these Looks, playlists and the Schedule.</p>}
      <div><h2 className="cap">Lights</h2>
        {lights.length === 0 ? <p className="note">No Lights yet.</p> : null}
        {lights.map((light) => {
          const n = changesFor(light.id).length;
          const row = now?.find((item) => item.lightId === light.id);
          return (
            <label className="check" key={light.id}>
              <input type="checkbox" checked={picked.has(light.id)} onChange={(event) => setPicked((set) => { const next = new Set(set); if (event.target.checked) next.add(light.id); else next.delete(light.id); return next; })} />
              {light.name}
              <span className="note" style={{ marginLeft: "auto" }}>{row && !row.online ? "didn't answer just now · " : ""}{n ? `${n} to send` : "up to date"}</span>
            </label>
          );
        })}
      </div>
      <p className="note">Writes the same preset numbers on every Light, reads them back, and backs up what was there first. Nothing changes what&apos;s on right now.</p>
      {scheduleBlocked ? <p className="warnnote">{scheduleBlocked} Fix it on the Schedule tab first.</p> : null}
      <div className="btnrow">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <span className="spacer" />
        <button type="button" className="btn primary" disabled={busy || picked.size === 0 || scheduleBlocked !== null} onClick={async () => {
          setBusy(true);
          setResult(await onSend([...picked]));
          setBusy(false);
        }}>{busy ? "Sending…" : "Send"}</button>
      </div>
    </Dialog>
  );
}
