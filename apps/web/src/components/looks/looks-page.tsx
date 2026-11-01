"use client";

import {
  LOOK_OFF_SLOT,
  dayOfYear,
  defaultScheduleDraft,
  formatClock,
  formatScheduleDate,
  guessWledTimezone,
  lookChangesFor,
  lookIncludesProp,
  propMode,
  propStyle,
  rowDays,
  rowRunName,
  scheduleRows,
  sectionsFollow,
  setPropMode,
  styleDotColour,
  withScheduleRows,
  WLED_CLOCK_TIMERS,
  WLED_TIMEZONES,
  type Look,
  type LookPlaylist,
  type NightlySchedule,
  type ScheduleRow,
} from "@nightplot/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AddToLooksDialog, NewLookDialog, SendDialog } from "./dialogs";
import { duplicateLook, newId, newLook, newPlaylist, playlistMinutes, takeDeleted, type DeletedLook } from "./looks-helpers";
import { effectOf } from "./style-editor";
import { useLooks, type LightLite, type LooksPayload, type LooksState, type NowRow } from "./use-looks";
import { StyleStrip, YardCanvas } from "./yard-canvas";

type Tab = "looks" | "playlists" | "schedule" | "byprop";
const TABS: [Tab, string][] = [["looks", "Looks"], ["playlists", "Playlists"], ["schedule", "Schedule"], ["byprop", "By prop"]];
type Toast = { text: string; action?: { label: string; kind: "send" } | { label: string; kind: "undo-delete"; stash: DeletedLook } };

export function LooksPage({ initial, lights }: { initial: LooksPayload; lights: LightLite[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const state = useLooks(initial, lights);
  const { doc, setDoc, flush, props, allPropIds, allChanges, changesFor, plan, now } = state;
  const [tab, setTab] = useState<Tab>(() => (TABS.some(([key]) => key === params.get("tab")) ? params.get("tab") as Tab : "looks"));
  const [sendOpen, setSendOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  // The yard's "Add to Looks…" lands here with ?add=<prop id>.
  const [addTo, setAddTo] = useState<string | null>(() => params.get("add"));

  // Done from a Look, or Delete, lands here with a note.
  const [toast, setToast] = useState<Toast | null>(() => {
    const saved = params.get("saved");
    const deleted = params.get("deleted");
    if (saved) {
      const look = initial.looks.find((row) => row.id === saved);
      if (look && lights.some((light) => lookChangesFor(initial, light.lastLookPush ?? null).some((change) => change.key === `look:${look.id}`))) {
        return { text: `${look.name} is saved. Send it to put it on the lights.`, action: { label: "Send", kind: "send" } };
      }
    }
    if (deleted && typeof window !== "undefined") {
      const stash = takeDeleted(deleted);
      if (stash) return { text: `Deleted ${stash.look.name}.`, action: { label: "Undo", kind: "undo-delete", stash } };
    }
    return null;
  });
  useEffect(() => {
    if (params.get("saved") || params.get("deleted") || params.get("add")) router.replace(`/looks${tab === "looks" ? "" : `?tab=${tab}`}`, { scroll: false });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 7000); return () => clearTimeout(id); }, [toast]);

  const go = useCallback((next: Tab) => {
    setTab(next);
    router.replace(next === "looks" ? "/looks" : `/looks?tab=${next}`, { scroll: false });
  }, [router]);

  const openLook = useCallback(async (id: string, propId?: string) => {
    await flush();
    router.push(`/looks/${id}${propId ? `?prop=${encodeURIComponent(propId)}` : ""}`);
  }, [flush, router]);

  const turnOn = useCallback(async (slot: number, key: string | null, name: string) => {
    const behind = key ? lights.filter((light) => changesFor(light.id).some((change) => change.key === key)).map((light) => light.id) : [];
    if (behind.length) {
      const sent = await state.send(behind);
      const failed = sent.rows.filter((row) => row.status !== "matched");
      if (failed.length) { setToast({ text: `${name} did not reach ${failed.map((row) => row.lightName).join(", ")}. ${failed[0]!.detail}` }); }
    }
    const message = await state.turnOn(slot);
    setToast({ text: `${message} The Schedule takes over at its next step.` });
  }, [changesFor, lights, state]);

  const pill = (() => {
    const behind = lights.filter((light) => changesFor(light.id).length > 0);
    const n = allChanges.length;
    if (!n) return <button type="button" className="sendpill ok" onClick={() => setSendOpen(true)}>Lights up to date</button>;
    if (behind.length < lights.length) {
      return <button type="button" className="sendpill" onClick={() => setSendOpen(true)}><span className="long">{behind.map((light) => light.name).join(", ")}: </span>{n} not sent · Send</button>;
    }
    return <button type="button" className="sendpill" onClick={() => setSendOpen(true)}>{n} change{n === 1 ? "" : "s"}<span className="long"> not on the lights</span> · Send</button>;
  })();

  const lonely = props.filter((prop) => doc.looks.length > 0 && doc.looks.every((look) => !lookIncludesProp(look, prop.id)));
  const addProp = addTo ? props.find((prop) => prop.id === addTo) : null;

  return (
    <div className="lk">
      <div className="page" style={{ overflow: "visible" }}>
        <div className="pagein">
          <div className="pagehead">
            <h1>Looks</h1><span className="spacer" />
            <span className={`note ${state.saveState === "error" ? "warnnote" : ""}`} role="status">{state.saveState === "saving" ? "Saving…" : state.saveState === "error" ? state.saveError : ""}</span>
            {pill}
          </div>
          <NowBar state={state} lights={lights} onSchedule={() => go("schedule")} />
          {lonely.length ? (
            <div className="banner">
              <b>{lonely.length === 1 ? `${lonely[0]!.label} is new.` : `${lonely.length} props are in no Look.`}</b>
              <span>{lonely.length === 1 ? "It's off in every Look until you add it." : lonely.map((prop) => prop.label).join(", ")}</span>
              <div className="btnrow">
                {lonely.length > 1 ? (
                  <button type="button" className="btn primary" onClick={() => {
                    setDoc((current) => ({ ...current, looks: current.looks.map((look) => lonely.reduce((acc, prop) => setPropMode(acc, allPropIds, prop, "follow"), look)) }));
                    setToast({ text: `${lonely.length} props added to every Look. Each follows the Look's style.` });
                  }}>Add all to every Look</button>
                ) : null}
                {lonely.slice(0, 4).map((prop) => <button type="button" key={prop.id} className={`btn ${lonely.length > 1 ? "" : "primary"}`} onClick={() => setAddTo(prop.id)}>Add {prop.label} to Looks…</button>)}
              </div>
            </div>
          ) : null}
          <div className="tabs" role="tablist">
            {TABS.map(([key, label]) => <button type="button" role="tab" key={key} aria-selected={tab === key} onClick={() => go(key)}>{label}</button>)}
          </div>
          {tab === "looks" ? <LooksTab state={state} lights={lights} onOpen={openLook} onNew={() => setNewOpen(true)} onTurnOn={turnOn}
            onDuplicate={async (look) => { const copy = duplicateLook(doc, look); if (!copy) { setToast({ text: "Every preset number is taken." }); return; } setDoc((current) => ({ ...current, looks: [...current.looks, copy] })); await openLook(copy.id); }} /> : null}
          {tab === "playlists" ? <PlaylistsTab state={state} onTurnOn={turnOn} onToast={(text) => setToast({ text })} /> : null}
          {tab === "schedule" ? <ScheduleTab state={state} /> : null}
          {tab === "byprop" ? <ByPropTab state={state} onOpen={openLook} onAdd={setAddTo} /> : null}
        </div>
      </div>
      {sendOpen ? (
        <SendDialog lights={lights} now={now} changesFor={changesFor} allChanges={allChanges}
          scheduleBlocked={doc.schedule?.enabled && plan?.error ? plan.error : null}
          onSend={state.send} onUndo={state.undoSend} onClose={() => setSendOpen(false)} />
      ) : null}
      {newOpen ? (
        <NewLookDialog looks={doc.looks} onClose={() => setNewOpen(false)} onMake={async (how, sourceId) => {
          const made = newLook(doc, how, allPropIds, doc.looks.find((row) => row.id === sourceId));
          if (!made) { setToast({ text: "Every preset number is taken." }); setNewOpen(false); return; }
          setDoc((current) => ({ ...current, looks: [...current.looks, made] }));
          setNewOpen(false);
          await openLook(made.id);
        }} />
      ) : null}
      {addProp ? (
        <AddToLooksDialog propLabel={addProp.label} looks={doc.looks} isIn={(look) => lookIncludesProp(look, addProp.id)} onClose={() => setAddTo(null)}
          onAdd={(ids) => {
            setDoc((current) => ({ ...current, looks: current.looks.map((look) => (ids.includes(look.id) ? setPropMode(look, allPropIds, addProp, "follow") : look)) }));
            setToast({ text: `${addProp.label} added to ${ids.length} Look${ids.length === 1 ? "" : "s"}.` });
            setAddTo(null);
          }} />
      ) : null}
      {toast ? (
        <div className="toast" role="status"><span>{toast.text}</span>
          {toast.action ? <button type="button" onClick={() => {
            const action = toast.action!;
            setToast(null);
            if (action.kind === "send") { setSendOpen(true); return; }
            const stash = action.stash;
            setDoc((current) => ({
              ...current,
              looks: current.looks.some((row) => row.slot === stash.look.slot) ? current.looks : [...current.looks, stash.look],
              playlists: [...current.playlists.filter((row) => !stash.playlists.some((old) => old.id === row.id)), ...stash.playlists],
            }));
            setToast({ text: `${stash.look.name} is back.` });
          }}>{toast.action.label}</button> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Now bar

function nameOfRun(row: NowRow, state: LooksState): string {
  const { doc } = state;
  if (row.previewing) return "a Preview";
  if (row.on === false) return "Off";
  const look = doc.looks.find((item) => item.id === row.lookId);
  const list = doc.playlists.find((item) => item.id === row.playlistId);
  if (list) return `${look?.name ?? "a Look"} · from ${list.name} playlist`;
  if (look) return look.name;
  if (row.preset === LOOK_OFF_SLOT) return "Off";
  if (row.preset) return `WLED preset ${row.preset} (not a Nightplot Look)`;
  return "Something set by hand in WLED";
}

function todayRow(schedule: NightlySchedule | null): ScheduleRow | null {
  if (!schedule?.enabled) return null;
  const date = new Date();
  const doy = dayOfYear({ month: date.getMonth() + 1, day: Math.min(date.getDate(), date.getMonth() === 1 ? 28 : 31) });
  const dow = 1 << ((date.getDay() + 6) % 7);
  return scheduleRows(schedule).find((row) => (row.weekdays & dow) && rowDays(row.dates).includes(doy)) ?? null;
}

function describeRow(row: ScheduleRow): { on: string; off: string } {
  const on = row.on.kind === "sunset" ? `on at sunset${row.on.offsetMinutes ? `${row.on.offsetMinutes > 0 ? " +" : " "}${row.on.offsetMinutes} min` : ""}` : `on at ${formatClock(row.on.hour * 60 + row.on.minute)}`;
  const off = row.off.kind === "time" ? `off at ${formatClock(row.off.hour * 60 + row.off.minute)}` : row.off.kind === "sunrise" ? "off at sunrise" : "stays on";
  return { on, off };
}

function NowBar({ state, lights, onSchedule }: { state: LooksState; lights: LightLite[]; onSchedule: () => void }) {
  const { now, changesFor, doc } = state;
  const rows = now ?? [];
  const up = rows.filter((row) => row.online);
  const groups = new Map<string, NowRow[]>();
  for (const row of up) { const key = nameOfRun(row, state); groups.set(key, [...(groups.get(key) ?? []), row]); }
  const main = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const today = todayRow(doc.schedule);
  const time = new Date().toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="nowbar">
      <div>
        <div className="note">Now on the lights · {time}</div>
        <div className="big">{now === null ? "Asking the Lights…" : main ? main[0] : lights.length ? "No Light answered" : "No Lights yet"}</div>
        {groups.size > 1 ? <div className="note">{[...groups.entries()].slice(1).map(([name, list]) => `${list.map((row) => row.lightName).join(", ")}: ${name}`).join(" · ")}</div> : null}
        <div className="lightsrow">
          {lights.map((light) => {
            const row = rows.find((item) => item.lightId === light.id);
            const down = now !== null && (!row || !row.online);
            const behind = changesFor(light.id).length;
            return <span key={light.id} className={`lightpill ${down ? "bad" : behind ? "behind" : ""}`}>{light.name}: {down ? "didn't answer" : behind ? `${behind} not sent` : "up to date"}</span>;
          })}
        </div>
        <div className="note" style={{ marginTop: 6 }}>
          {today ? `Today the Schedule runs ${rowRunName(today, doc)}, ${describeRow(today).on}, ${describeRow(today).off}.` : doc.schedule?.enabled ? "The Schedule has nothing for today." : "No Schedule yet; the lights stay as they are until you turn something on."}
        </div>
      </div>
      <div className="btnrow"><button type="button" className="btn" onClick={onSchedule}>Schedule</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- Looks tab

function LooksTab({ state, lights, onOpen, onNew, onTurnOn, onDuplicate }: {
  state: LooksState; lights: LightLite[];
  onOpen: (id: string) => void; onNew: () => void;
  onTurnOn: (slot: number, key: string | null, name: string) => void;
  onDuplicate: (look: Look) => void;
}) {
  const { doc, props, drawn, now, changesFor } = state;
  return (
    <>
      <div className="cards">
        {doc.looks.map((look) => {
          const key = `look:${look.id}`;
          const states = lights.map((light) => changesFor(light.id).find((change) => change.key === key)?.kind ?? null);
          const isNew = lights.length > 0 && states.every((kind) => kind === "new");
          const pending = states.some((kind) => kind !== null);
          const live = (now ?? []).some((row) => row.online && row.lookId === look.id && !row.previewing);
          const used = doc.playlists.filter((row) => row.lookIds.includes(look.id)).map((row) => row.name);
          const on = props.filter((prop) => lookIncludesProp(look, prop.id)).length;
          return (
            <div className="card" key={look.id}>
              <button type="button" onClick={() => onOpen(look.id)} style={{ padding: 0, border: 0, background: "transparent" }} aria-label={`Edit ${look.name}`}>
                <YardCanvas drawn={drawn} props={props} look={look} small ariaLabel={`${look.name} drawn on the yard`} className="thumb" />
              </button>
              <div className="body">
                <div className="row"><h3>{look.name}</h3>{live ? <span className="tag live">On now</span> : null}{isNew ? <span className="tag new">Not sent</span> : pending ? <span className="tag new">Changed</span> : null}</div>
                <div className="note">{on} of {props.length} props{used.length ? ` · in ${used.join(", ")}` : ""}</div>
                <div className="row">
                  <button type="button" className="btn small" onClick={() => onOpen(look.id)}>Edit</button>
                  <button type="button" className="btn small" disabled={lights.length === 0} onClick={() => onTurnOn(look.slot, key, look.name)}>{pending ? "Send and turn on" : "Turn on now"}</button>
                  <span className="spacer" />
                  <button type="button" className="btn small link" onClick={() => onDuplicate(look)}>Duplicate</button>
                </div>
              </div>
            </div>
          );
        })}
        <button type="button" className="card add" onClick={onNew}><b style={{ fontSize: 28 }}>+</b>New Look</button>
      </div>
      <p className="note">A Look is one WLED preset with the same number on every Light. Changes save in Nightplot as you make them, and reach the lights when you Send.</p>
    </>
  );
}

// ---------------------------------------------------------------- Playlists tab

function PlaylistsTab({ state, onTurnOn, onToast }: { state: LooksState; onTurnOn: (slot: number, key: string | null, name: string) => void; onToast: (text: string) => void }) {
  const { doc, setDoc, catalog } = state;
  const [open, setOpen] = useState<string | null>(null);
  const setList = (id: string, update: (row: LookPlaylist) => LookPlaylist) =>
    setDoc((current) => ({ ...current, playlists: current.playlists.map((row) => (row.id === id ? update(row) : row)) }));
  const withMinutes = (row: LookPlaylist, minutes: number[], lookIds = row.lookIds): LookPlaylist =>
    ({ ...row, lookIds, durationsTenths: minutes.map((m) => Math.min(36000, Math.max(600, m * 600))), durationTenths: Math.min(36000, Math.max(600, (minutes[0] ?? 1) * 600)) });
  const dot = (id: string) => { const look = doc.looks.find((row) => row.id === id); return look ? styleDotColour(look.style, effectOf(look.style.fx, catalog.effects)) ?? "#333" : "#333"; };
  return (
    <>
      <div className="list">
        {doc.playlists.map((row) => {
          const minutes = playlistMinutes(row);
          const total = minutes.reduce((a, b) => a + b, 0);
          const isOpen = open === row.id;
          return (
            <div className={`item ${isOpen ? "open" : ""}`} key={row.id}>
              <div className="itemhead">
                <h3>{row.name}</h3><span className="sub">{row.lookIds.length} Looks · {total} min {row.repeat === false ? "· then off" : "· repeats"}</span><span className="spacer" />
                <button type="button" className="btn small" onClick={() => onTurnOn(row.slot, `playlist:${row.id}`, `${row.name} playlist`)}>Turn on now</button>
                <button type="button" className="btn small" onClick={() => setOpen(isOpen ? null : row.id)}>{isOpen ? "Close" : "Edit"}</button>
              </div>
              <div style={{ display: "flex", gap: 3, height: 12 }}>
                {row.lookIds.map((id, index) => <span key={`${id}-${index}`} title={doc.looks.find((look) => look.id === id)?.name} style={{ flex: minutes[index], borderRadius: 3, background: dot(id) }} />)}
              </div>
              {isOpen ? (
                <>
                  <label className="f">Name<input className="in" defaultValue={row.name} autoFocus={/^Playlist \d+$/.test(row.name)} onFocus={(event) => event.target.select()}
                    onChange={(event) => { const name = event.target.value.trim(); if (name) setList(row.id, (item) => ({ ...item, name: name.slice(0, 32) })); }} /></label>
                  <div className="list" style={{ gap: 6 }}>
                    {row.lookIds.map((id, index) => (
                      <div className="plrow" key={`${id}-${index}`}>
                        <span className="ix">{index + 1}</span>
                        <select className="in" aria-label={`Look ${index + 1}`} value={id} onChange={(event) => setList(row.id, (item) => { const ids = [...item.lookIds]; ids[index] = event.target.value; return withMinutes(item, playlistMinutes(item), ids); })}>
                          {doc.looks.map((look) => <option key={look.id} value={look.id}>{look.name}</option>)}
                        </select>
                        <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <input className="in num" type="number" min={1} max={60} style={{ width: 56 }} aria-label={`Minutes for Look ${index + 1}`} defaultValue={minutes[index]}
                            onFocus={(event) => event.target.select()}
                            onChange={(event) => { const v = Math.round(Number(event.target.value)); if (v >= 1) setList(row.id, (item) => { const m = playlistMinutes(item); m[index] = Math.min(60, v); return withMinutes(item, m); }); }} />min
                        </label>
                        <span className="btnrow" style={{ flexWrap: "nowrap" }}>
                          <button type="button" className="btn small" aria-label="Move up" disabled={index === 0} onClick={() => setList(row.id, (item) => {
                            const ids = [...item.lookIds]; const m = playlistMinutes(item);
                            [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!]; [m[index - 1], m[index]] = [m[index]!, m[index - 1]!];
                            return withMinutes(item, m, ids);
                          })}>↑</button>
                          <button type="button" className="btn small" aria-label="Remove" disabled={row.lookIds.length === 1} onClick={() => setList(row.id, (item) => {
                            const ids = item.lookIds.filter((_, i) => i !== index); const m = playlistMinutes(item).filter((_, i) => i !== index);
                            return withMinutes(item, m, ids);
                          })}>✕</button>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="btnrow"><button type="button" className="btn" disabled={!doc.looks.length} onClick={() => setList(row.id, (item) => withMinutes(item, [...playlistMinutes(item), 10], [...item.lookIds, doc.looks[0]!.id]))}>+ Add a Look</button></div>
                  <div className="grid2">
                    <label className="f">Fade between Looks (seconds)
                      <input className="in num" type="number" min={0} step={0.1} defaultValue={row.transitionTenths / 10}
                        onChange={(event) => { const v = Number(event.target.value); if (Number.isFinite(v) && v >= 0) setList(row.id, (item) => ({ ...item, transitionTenths: Math.min(255, Math.round(v * 10)) })); }} />
                    </label>
                    <label className="f">After the last Look
                      <select className="in" value={row.repeat === false ? "0" : "1"} onChange={(event) => setList(row.id, (item) => ({ ...item, repeat: event.target.value === "1" }))}>
                        <option value="1">Start again</option><option value="0">Turn off</option>
                      </select>
                    </label>
                  </div>
                  <div className="btnrow"><span className="note">WLED preset {row.slot}</span><span className="spacer" />
                    <button type="button" className="btn small danger" onClick={() => {
                      if (doc.schedule && scheduleRows(doc.schedule).some((item) => item.run.kind === "playlist" && item.run.playlistId === row.id)) { onToast("The Schedule runs this playlist. Change that row first."); return; }
                      setDoc((current) => ({ ...current, playlists: current.playlists.filter((item) => item.id !== row.id) }));
                    }}>Delete playlist</button>
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
        <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={!doc.looks.length} onClick={() => {
          const made = newPlaylist(doc);
          if (!made) { onToast(doc.looks.length ? "Every preset number is taken." : "Make a Look first."); return; }
          setDoc((current) => ({ ...current, playlists: [...current.playlists, made] }));
          setOpen(made.id);
        }}>+ New playlist</button>
      </div>
      <p className="note">A playlist is a WLED preset too. It runs on each Light by itself, so Nightplot can be closed.</p>
    </>
  );
}

// ---------------------------------------------------------------- Schedule tab

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ROW_COLOURS = ["#1f8f80", "#85552c", "#6a4caf", "#2f6fae", "#a0452f"];

function ScheduleTab({ state }: { state: LooksState }) {
  const { doc, setDoc, plan } = state;
  const [open, setOpen] = useState<string | null>(null);
  // Opens itself while sunset has no place, and stays open while it's typed.
  const [placeOpen, setPlaceOpen] = useState(false);
  const schedule = doc.schedule;
  const rows = schedule ? (schedule.enabled || schedule.rows ? scheduleRows(schedule) : []) : [];
  const runs = useMemo(() => [
    ...doc.playlists.map((row) => [`playlist:${row.id}`, `${row.name} playlist`] as const),
    ...doc.looks.map((row) => [`look:${row.id}`, row.name] as const),
  ], [doc.looks, doc.playlists]);

  const base = (): NightlySchedule => schedule ?? defaultScheduleDraft(doc.looks, doc.playlists, guessWledTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone));
  const setRows = (next: ScheduleRow[]) => setDoc((current) => {
    const from = current.schedule ?? base();
    return { ...current, schedule: { ...withScheduleRows(from, next), enabled: next.length > 0 } };
  });
  const setRow = (id: string, update: (row: ScheduleRow) => ScheduleRow) => setRows(rows.map((row) => (row.id === id ? update(row) : row)));
  const runOf = (value: string): ScheduleRow["run"] => value.startsWith("playlist:") ? { kind: "playlist", playlistId: value.slice(9) } : { kind: "look", lookId: value.slice(5) };
  const today = new Date();
  const todayDoy = dayOfYear({ month: today.getMonth() + 1, day: Math.min(today.getDate(), MDAYS[today.getMonth()]!) });
  const over = (plan?.clockUsed ?? 0) > WLED_CLOCK_TIMERS;
  const ntp = schedule?.ntp ?? base().ntp;
  const setNtp = (patch: Partial<NightlySchedule["ntp"]>) => setDoc((current) => ({ ...current, schedule: { ...(current.schedule ?? base()), ntp: { ...(current.schedule ?? base()).ntp, ...patch } } }));
  const needsPlace = rows.some((row) => row.on.kind === "sunset" || row.off.kind === "sunrise") && ntp.latitude === 0 && ntp.longitude === 0;

  return (
    <div className="list">
      <div className="yearbar" aria-label="The year, with what each row covers">
        {MONTHS.map((m, i) => <span key={m} className="m" style={{ left: `${(dayOfYear({ month: i + 1, day: 1 }) - 1) / 365 * 100}%` }}>{m}</span>)}
        {rows.map((row, ri) => {
          const cover: { a: number; b: number }[] = [];
          for (const d of rowDays(row.dates)) { const last = cover[cover.length - 1]; if (last && d === last.b + 1) last.b = d; else cover.push({ a: d, b: d }); }
          return cover.map((c) => <span key={`${row.id}-${c.a}`} className="r" style={{ top: 18 + (ri % 2) * 17, left: `${(c.a - 1) / 365 * 100}%`, width: `${(c.b - c.a + 1) / 365 * 100}%`, background: ROW_COLOURS[ri % ROW_COLOURS.length] }}>{rowRunName(row, doc)}</span>);
        })}
        <span className="today" style={{ left: `${(todayDoy - 1) / 365 * 100}%` }} title="Today" />
      </div>
      <p className="note">When two rows cover the same day, the higher row wins. Move a row up with ↑.</p>
      {needsPlace ? <p className="warnnote" role="alert">Sunset needs where the lights are. Set the latitude and longitude under “Where the lights are” below; the Schedule is not saved until then.</p> : null}
      {rows.length === 0 ? <p className="note">Nothing is scheduled. The lights stay as they are until you turn something on.</p> : null}
      {rows.map((row, index) => {
        const isOpen = open === row.id;
        const desc = describeRow(row);
        const dates = row.dates ? `${formatScheduleDate(row.dates.from)} – ${formatScheduleDate(row.dates.to)}` : "All year";
        const days = row.weekdays === 127 ? "every day" : WEEKDAYS.filter((_, k) => row.weekdays & (1 << k)).join(", ");
        return (
          <div className={`item ${isOpen ? "open" : ""}`} key={row.id}>
            <div className="itemhead">
              <h3>{rowRunName(row, doc)}</h3><span className="sub">{dates} · {days} · {desc.on} · {desc.off}</span><span className="spacer" />
              <button type="button" className="btn small" aria-label="Move up" disabled={index === 0} onClick={() => { const next = [...rows]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; setRows(next); }}>↑</button>
              <button type="button" className="btn small" onClick={() => setOpen(isOpen ? null : row.id)}>{isOpen ? "Close" : "Edit"}</button>
            </div>
            {(plan?.notes[row.id] ?? []).map((note) => <p className="note" key={note}>{note}</p>)}
            {isOpen ? (
              <>
                <label className="f">Runs
                  <select className="in" value={row.run.kind === "playlist" ? `playlist:${row.run.playlistId}` : `look:${row.run.lookId}`} onChange={(event) => setRow(row.id, (item) => ({ ...item, run: runOf(event.target.value) }))}>
                    {runs.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                  </select>
                </label>
                <div className="f" style={{ fontSize: 12, color: "var(--muted)" }}>Dates
                  <div className="seg3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <button type="button" aria-pressed={!row.dates} onClick={() => setRow(row.id, (item) => ({ ...item, dates: null }))}>All year</button>
                    <button type="button" aria-pressed={!!row.dates} onClick={() => setRow(row.id, (item) => ({ ...item, dates: item.dates ?? { from: { month: 11, day: 25 }, to: { month: 1, day: 6 } } }))}>From – to</button>
                  </div>
                </div>
                {row.dates ? (
                  <div className="grid2">
                    {(["from", "to"] as const).map((k) => (
                      <label className="f" key={k}>{k === "from" ? "From" : "To"}
                        <span style={{ display: "flex", gap: 6 }}>
                          <select className="in" aria-label={`${k} month`} value={row.dates![k].month} onChange={(event) => setRow(row.id, (item) => {
                            const month = Number(event.target.value); const day = Math.min(item.dates![k].day, MDAYS[month - 1]!);
                            return { ...item, dates: { ...item.dates!, [k]: { month, day } } };
                          })}>{MONTHS.map((m, mi) => <option key={m} value={mi + 1}>{m}</option>)}</select>
                          <input className="in num" type="number" min={1} max={31} style={{ width: 64 }} aria-label={`${k} day`} value={row.dates![k].day}
                            onChange={(event) => setRow(row.id, (item) => {
                              const day = Math.max(1, Math.min(MDAYS[item.dates![k].month - 1]!, Math.round(Number(event.target.value)) || 1));
                              return { ...item, dates: { ...item.dates!, [k]: { month: item.dates![k].month, day } } };
                            })} />
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
                <div className="f" style={{ fontSize: 12, color: "var(--muted)" }}>Days
                  <div className="days">
                    {WEEKDAYS.map((d, k) => (
                      <button type="button" key={d} aria-pressed={!!(row.weekdays & (1 << k))} onClick={() => setRow(row.id, (item) => { const next = item.weekdays ^ (1 << k); return { ...item, weekdays: next || (1 << k) }; })}>{d}</button>
                    ))}
                  </div>
                </div>
                <div className="grid2">
                  <label className="f">Turn on
                    <select className="in" value={row.on.kind} onChange={(event) => setRow(row.id, (item) => ({ ...item, on: event.target.value === "sunset" ? { kind: "sunset", offsetMinutes: 0 } : { kind: "time", hour: 17, minute: 0 } }))}>
                      <option value="sunset">At sunset</option><option value="time">At a time</option>
                    </select>
                  </label>
                  {row.on.kind === "sunset" ? (
                    <label className="f">Minutes after sunset (− before)
                      <input className="in num" type="number" min={-120} max={120} value={row.on.offsetMinutes}
                        onChange={(event) => setRow(row.id, (item) => ({ ...item, on: { kind: "sunset", offsetMinutes: Math.max(-120, Math.min(120, Math.round(Number(event.target.value)) || 0)) } }))} />
                    </label>
                  ) : (
                    <label className="f">Time
                      <input className="in num" type="time" value={`${String(row.on.hour).padStart(2, "0")}:${String(row.on.minute).padStart(2, "0")}`}
                        onChange={(event) => { const [h, m] = event.target.value.split(":").map(Number); if (Number.isInteger(h) && Number.isInteger(m)) setRow(row.id, (item) => ({ ...item, on: { kind: "time", hour: h!, minute: m! } })); }} />
                    </label>
                  )}
                </div>
                <div className="grid2">
                  <label className="f">Turn off
                    <select className="in" value={row.off.kind} onChange={(event) => setRow(row.id, (item) => ({ ...item, off: event.target.value === "time" ? { kind: "time", hour: 23, minute: 0 } : { kind: event.target.value as "sunrise" | "none" } }))}>
                      <option value="time">At a time</option><option value="sunrise">At sunrise</option><option value="none">Leave on</option>
                    </select>
                  </label>
                  {row.off.kind === "time" ? (
                    <label className="f">Time
                      <input className="in num" type="time" value={`${String(row.off.hour).padStart(2, "0")}:${String(row.off.minute).padStart(2, "0")}`}
                        onChange={(event) => { const [h, m] = event.target.value.split(":").map(Number); if (Number.isInteger(h) && Number.isInteger(m)) setRow(row.id, (item) => ({ ...item, off: { kind: "time", hour: h!, minute: m! } })); }} />
                    </label>
                  ) : <span />}
                </div>
                {row.dates && row.on.kind === "sunset" ? (
                  <p className="note">WLED&apos;s sunset timer can&apos;t be limited to dates, so this row follows sunset with clock times (listed above).{" "}
                    <button type="button" className="btn link" onClick={() => setRow(row.id, (item) => ({ ...item, on: { kind: "time", hour: 17, minute: 0 } }))}>Use one clock time instead</button></p>
                ) : null}
                <div className="btnrow"><span className="spacer" />
                  <button type="button" className="btn small danger" onClick={() => setRows(rows.filter((item) => item.id !== row.id))}>Remove from schedule</button>
                </div>
              </>
            ) : null}
          </div>
        );
      })}
      <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={!runs.length} onClick={() => {
        const id = newId("row");
        const last = doc.playlists[doc.playlists.length - 1];
        const run: ScheduleRow["run"] = last ? { kind: "playlist", playlistId: last.id } : { kind: "look", lookId: doc.looks[0]!.id };
        const fresh: ScheduleRow = rows.length
          ? { id, run, dates: { from: { month: 11, day: 25 }, to: { month: 1, day: 6 } }, weekdays: 127, on: { kind: "sunset", offsetMinutes: 0 }, off: { kind: "time", hour: 23, minute: 0 } }
          : { id, run, dates: null, weekdays: 127, on: { kind: "sunset", offsetMinutes: 0 }, off: { kind: "time", hour: 23, minute: 0 } };
        setRows([fresh, ...rows]);
        setOpen(id);
      }}>+ Add to the schedule</button>
      <div className="item">
        <div className="itemhead"><h3>WLED timers</h3><span className="sub">The Schedule runs on each Light with Nightplot closed.</span></div>
        <div className="budget">
          {Array.from({ length: WLED_CLOCK_TIMERS }, (_, i) => <i key={i} className={i < (plan?.clockUsed ?? 0) ? (over ? "x" : "u") : ""} />)}
          <span style={{ marginLeft: 6 }}>{plan?.clockUsed ?? 0} of {WLED_CLOCK_TIMERS} clock timers</span>
          <span style={{ marginLeft: 12 }}>Sunset timer: {plan?.sunsetRowId ? rowRunName(rows.find((row) => row.id === plan.sunsetRowId)!, doc) : "free"}</span>
          <span style={{ marginLeft: 12 }}>Sunrise timer: {plan?.sunriseUsed ? "used" : "free"}</span>
        </div>
        {rows.length && plan?.error ? <p className="warnnote">{plan.error} Send is blocked until it fits.</p> : null}
        <details className="fold" open={placeOpen || needsPlace} onToggle={(event) => setPlaceOpen(event.currentTarget.open)}>
          <summary>Where the lights are <span className="meta">{WLED_TIMEZONES.find((zone) => zone.tz === ntp.tz)?.label ?? `zone ${ntp.tz}`}{ntp.latitude || ntp.longitude ? ` · ${ntp.latitude.toFixed(2)}, ${ntp.longitude.toFixed(2)}` : ""}</span></summary>
          <div className="foldbody">
            <div className="grid2">
              <label className="f">Latitude<input className="in num" type="number" step={0.01} min={-90} max={90} defaultValue={ntp.latitude || ""} key={`lat-${ntp.latitude}`}
                onBlur={(event) => { const v = Number(event.target.value); if (Number.isFinite(v)) setNtp({ latitude: Math.max(-90, Math.min(90, v)) }); }} /></label>
              <label className="f">Longitude<input className="in num" type="number" step={0.01} min={-180} max={180} defaultValue={ntp.longitude || ""} key={`lon-${ntp.longitude}`}
                onBlur={(event) => { const v = Number(event.target.value); if (Number.isFinite(v)) setNtp({ longitude: Math.max(-180, Math.min(180, v)) }); }} /></label>
            </div>
            <div className="btnrow">
              <button type="button" className="btn small" onClick={() => navigator.geolocation?.getCurrentPosition((pos) => setNtp({ latitude: Math.round(pos.coords.latitude * 100) / 100, longitude: Math.round(pos.coords.longitude * 100) / 100 }))}>Use this device&apos;s location</button>
            </div>
            <label className="f">Time zone (WLED&apos;s list)
              <select className="in" value={ntp.tz} onChange={(event) => setNtp({ tz: Number(event.target.value) })}>
                {WLED_TIMEZONES.map((zone) => <option key={zone.tz} value={zone.tz}>{zone.label}</option>)}
              </select>
            </label>
            <p className="note">Each Light works out its own sunset from this place and zone. Nightplot uses the same sums to plan the clock times for dated sunset rows.</p>
          </div>
        </details>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- By prop tab

function ByPropTab({ state, onOpen, onAdd }: { state: LooksState; onOpen: (id: string, propId?: string) => void; onAdd: (propId: string) => void }) {
  const { doc, props, drawn, catalog } = state;
  return (
    <>
      <div className="matrixwrap">
        <table className="matrix">
          <thead><tr><th>Prop</th>{doc.looks.map((look) => <th key={look.id}>{look.name}</th>)}</tr></thead>
          <tbody>
            {props.map((prop) => {
              const sections = drawn.find((row) => row.id === prop.id)?.sections.length ?? 0;
              return (
                <tr key={prop.id}>
                  <td>{prop.label}{doc.looks.every((look) => !lookIncludesProp(look, prop.id)) ? <> <button type="button" className="btn small" onClick={() => onAdd(prop.id)}>Add to Looks…</button></> : null}</td>
                  {doc.looks.map((look) => {
                    const mode = propMode(look, prop);
                    const style = propStyle(look, prop);
                    return (
                      <td key={look.id}>
                        <button type="button" className={`cell ${mode === "off" ? "off" : ""}`} onClick={() => onOpen(look.id, prop.id)} aria-label={`${prop.label} in ${look.name}`}>
                          {mode === "off" ? "Off" : <><StyleStrip style={style} count={24} />{mode === "own" ? effectOf(style.fx, catalog.effects).name : "Follows"}{sections && !sectionsFollow(look, prop.id) ? " · sections" : ""}</>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">Click a cell to open that Look with the prop selected.</p>
      {props.length === 0 ? <p className="note">No props yet. <Link href="/">Draw one on the yard</Link>.</p> : null}
    </>
  );
}
