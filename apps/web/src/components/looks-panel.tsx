"use client";

import {
  LOOK_EFFECTS,
  LOOK_PALETTES,
  PROP_KINDS,
  WLED_TIMEZONES,
  defaultScheduleDraft,
  nextLookSlot,
  propKindLabel,
  type LightView,
  type Look,
  type LookOverride,
  type LookPlaylist,
  type LookStyle,
  type LooksDocument,
  type NightlySchedule,
  type Prop,
  type PropKind,
  type SyncResult,
} from "@nightplot/shared";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson, putJson } from "@/lib/api";

export type LooksPayload = LooksDocument & {
  yard: {
    lights: { id: string; name: string }[];
    props: (Prop & { lightName: string })[];
    elements: { id: string; lightId: string; label: string; start: number; stop: number; lightName: string }[];
  };
  caption: string;
};

const STATUS_COPY: Record<SyncResult["rows"][number]["status"], string> = {
  matched: "Matched",
  mismatch: "Differs",
  unknown: "Unknown",
  failed: "Failed",
  refused: "Not sent",
};

const selectClass = "h-10 rounded-md border border-border bg-background px-3";

function blankStyle(): LookStyle {
  return { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" };
}

function newLookId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `look-${Date.now()}`;
}

/** Looks library, nightly Schedule, and a bulk push of the same WLED preset slots. */
export function LooksPanel({ lights, initial }: { lights: LightView[]; initial: LooksPayload }) {
  const [looks, setLooks] = useState<Look[]>(initial.looks);
  const [playlists, setPlaylists] = useState<LookPlaylist[]>(initial.playlists);
  const [schedule, setSchedule] = useState<NightlySchedule>(
    initial.schedule ?? defaultScheduleDraft(initial.looks, initial.playlists),
  );
  const [openId, setOpenId] = useState<string | null>(initial.looks[0]?.id ?? null);
  const [selected, setSelected] = useState<string[]>(lights.map((light) => light.id));
  const [includeSchedule, setIncludeSchedule] = useState(initial.schedule?.enabled === true);
  const [udpOn, setUdpOn] = useState(false);
  const [udpGroup, setUdpGroup] = useState(2);
  const [udpLeader, setUdpLeader] = useState(lights[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const playlist = playlists[0] ?? null;

  const usedSlots = useMemo(
    () => [...looks.map((row) => row.slot), ...playlists.map((row) => row.slot)],
    [looks, playlists],
  );

  function updateLook(id: string, patch: Partial<Look>) {
    setLooks((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setSavedNote(null);
  }

  function updateStyle(id: string, patch: Partial<LookStyle>) {
    setLooks((current) => current.map((row) => (row.id === id ? { ...row, style: { ...row.style, ...patch } } : row)));
    setSavedNote(null);
  }

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try { await work(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Looks did not finish. Check each Light before retrying."); }
    finally { setBusy(null); }
  }

  async function persistLibrary(): Promise<LooksPayload> {
    const res = await putJson<LooksPayload>("/api/looks", { looks, playlists, schedule });
    if (!res.ok) throw new Error(res.data.message ?? "Looks were not saved.");
    setLooks(res.data.looks);
    setPlaylists(res.data.playlists);
    if (res.data.schedule) setSchedule(res.data.schedule);
    return res.data;
  }

  async function saveLibrary() {
    await run("Saving Looks…", async () => {
      await persistLibrary();
      setSavedNote("Saved in Nightplot. Push to write the controllers.");
    });
  }

  async function push() {
    await run("Pushing Looks…", async () => {
      await persistLibrary();
      const udp = udpOn && udpLeader
        ? {
            group: udpGroup,
            roles: Object.fromEntries(selected.map((id) => [id, id === udpLeader ? "leader" : "follower"])),
          }
        : undefined;
      const res = await postJson<SyncResult>("/api/looks/push", {
        lightIds: selected,
        includeSchedule,
        ...(udp ? { udp } : {}),
      });
      if (!res.ok) throw new Error(res.data.message ?? "Looks were not sent.");
      setResult(res.data);
    });
  }

  async function turnOn(presetId: number) {
    await run(`Turning on preset ${presetId}…`, async () => {
      const res = await postJson<SyncResult>("/api/sync/preset", { lightIds: selected, presetId });
      if (!res.ok) throw new Error(res.data.message ?? "Preset was not sent.");
      setResult(res.data);
    });
  }

  function addLook() {
    const slot = nextLookSlot(usedSlots);
    if (slot === null) return;
    const row: Look = { id: newLookId(), name: "New Look", slot, style: blankStyle(), overrides: [] };
    setLooks((current) => [...current, row]);
    setOpenId(row.id);
    setSavedNote(null);
  }

  function addOverride(lookId: string, override: LookOverride) {
    setLooks((current) => current.map((row) => (
      row.id === lookId ? { ...row, overrides: [...row.overrides, override] } : row
    )));
    setSavedNote(null);
  }

  const disabled = Boolean(busy);

  return (
    <section className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Looks</h1>
        <p className="text-[14px] text-muted-foreground">
          A library of Looks — colour, effect, palette, speed and brightness — with a whole-yard default and optional overrides per Prop.
          Push writes the same WLED preset numbers on every selected Light, plus an optional playlist and nightly Schedule.
          The Schedule is WLED timers and NTP, so the yard runs with Nightplot closed.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[16px] font-medium">Library</h2>
          <Button variant="outline" disabled={disabled || nextLookSlot(usedSlots) === null} onClick={addLook}>Add Look</Button>
        </div>
        <ul className="flex flex-col gap-2">
          {looks.map((row) => (
            <li key={row.id} className="rounded-[14px] border border-border p-4">
              <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpenId(openId === row.id ? null : row.id)}>
                <span className="font-medium">{row.slot} · {row.name}</span>
                <span className="text-[13px] text-quiet">{LOOK_EFFECTS.find((effect) => effect.fx === row.style.fx)?.label ?? `Effect ${row.style.fx}`}</span>
              </button>
              {openId === row.id ? (
                <LookEditor
                  look={row}
                  yard={initial.yard}
                  onName={(name) => updateLook(row.id, { name })}
                  onSlot={(slot) => updateLook(row.id, { slot })}
                  onStyle={(patch) => updateStyle(row.id, patch)}
                  onAddOverride={(override) => addOverride(row.id, override)}
                  onRemoveOverride={(index) => updateLook(row.id, { overrides: row.overrides.filter((_, item) => item !== index) })}
                  onRemove={() => { setLooks((current) => current.filter((item) => item.id !== row.id)); setOpenId(null); }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {playlist ? (
        <div className="flex flex-col gap-3 border-t border-border pt-5">
          <h2 className="text-[16px] font-medium">Playlist</h2>
          <p className="text-[13px] text-muted-foreground">Optional. Stored as WLED playlist preset {playlist.slot} on every Light.</p>
          <label className="flex flex-col gap-1 text-[14px] sm:max-w-sm">
            <span className="font-medium">Name</span>
            <Input aria-label="Playlist name" value={playlist.name} onChange={(event) => setPlaylists([{ ...playlist, name: event.target.value }])} />
          </label>
          <label className="flex flex-col gap-1 text-[14px] sm:max-w-xs">
            <span className="font-medium">Seconds each Look</span>
            <Input aria-label="Playlist duration seconds" type="number" min={1} max={3600}
              value={Math.round(playlist.durationTenths / 10)}
              onChange={(event) => setPlaylists([{ ...playlist, durationTenths: Math.max(1, Number(event.target.value) || 1) * 10 }])} />
          </label>
        </div>
      ) : null}

      <ScheduleEditor schedule={schedule} looks={looks} playlists={playlists} onChange={setSchedule} />

      <div className="flex flex-wrap gap-3">
        <Button disabled={disabled} onClick={() => void saveLibrary()}>Save library</Button>
        {savedNote ? <p className="self-center text-[13px] text-muted-foreground">{savedNote}</p> : null}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-5">
        <h2 className="text-[16px] font-medium">Push to Lights</h2>
        <p className="text-[13px] text-muted-foreground">
          Writes the library as the same numbered WLED presets on each selected Light, after a safety backup, then rereads.
          One dead controller is listed and does not stop the rest.
        </p>
        {lights.length === 0 ? <p className="text-[14px] text-muted-foreground">Enroll Lights first. The library can still be saved in Nightplot.</p> : (
          <fieldset className="flex flex-col gap-2 text-[14px]">
            <legend className="mb-1 font-medium">Lights</legend>
            {lights.map((light) => (
              <label key={light.id} className="flex items-center gap-2">
                <input type="checkbox" checked={selected.includes(light.id)}
                  onChange={() => setSelected((current) => current.includes(light.id) ? current.filter((id) => id !== light.id) : [...current, light.id])} />
                <span>{light.name}</span>
                {light.reachability !== "online" ? <span className="text-quiet">· last seen offline</span> : null}
                {light.propCount > 0 ? <span className="text-quiet">· {light.propCount} Prop{light.propCount === 1 ? "" : "s"}</span> : null}
              </label>
            ))}
          </fieldset>
        )}
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={includeSchedule} onChange={(event) => setIncludeSchedule(event.target.checked)} />
          <span>Write the nightly Schedule (NTP + timers)</span>
        </label>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={udpOn} onChange={(event) => setUdpOn(event.target.checked)} />
          <span>Also set a WLED UDP sync group so effects line up</span>
        </label>
        {udpOn ? (
          <div className="flex flex-wrap gap-3 text-[14px]">
            <label className="flex items-center gap-2">
              <span className="font-medium">Group</span>
              <select aria-label="UDP sync group" className={selectClass} value={udpGroup} onChange={(event) => setUdpGroup(Number(event.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="font-medium">Leader</span>
              <select aria-label="UDP sync leader" className={selectClass} value={udpLeader} onChange={(event) => setUdpLeader(event.target.value)}>
                {lights.filter((light) => selected.includes(light.id)).map((light) => <option key={light.id} value={light.id}>{light.name}</option>)}
              </select>
            </label>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button disabled={disabled || selected.length === 0} onClick={() => void push()}>Push Looks</Button>
          {looks[0] ? <Button variant="outline" disabled={disabled || selected.length === 0} onClick={() => void turnOn(looks[0]!.slot)}>Turn on {looks[0].name}</Button> : null}
          {playlist ? <Button variant="outline" disabled={disabled || selected.length === 0} onClick={() => void turnOn(playlist.slot)}>Turn on playlist</Button> : null}
        </div>
      </div>

      {busy ? <p className="text-[13px] text-muted-foreground">{busy}</p> : null}
      {error ? <p role="alert" className="text-[13px] text-[#f0a3a3]">{error}</p> : null}
      {result ? (
        <div className="flex flex-col gap-2 rounded-[14px] border border-border p-4 text-[13px]">
          <p className="font-medium">{result.message}</p>
          <ul className="flex flex-col gap-1">
            {result.rows.map((entry) => (
              <li key={entry.lightId}>
                <span className="font-medium">{entry.lightName}</span> · {STATUS_COPY[entry.status]} · {entry.detail}
                {entry.safetyBackupId ? <span className="text-quiet"> Safety backup {entry.safetyBackupId}.</span> : null}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-quiet">{result.caption}</p>
        </div>
      ) : null}
    </section>
  );
}

function LookEditor({
  look,
  yard,
  onName,
  onSlot,
  onStyle,
  onAddOverride,
  onRemoveOverride,
  onRemove,
}: {
  look: Look;
  yard: LooksPayload["yard"];
  onName: (name: string) => void;
  onSlot: (slot: number) => void;
  onStyle: (patch: Partial<LookStyle>) => void;
  onAddOverride: (override: LookOverride) => void;
  onRemoveOverride: (index: number) => void;
  onRemove: () => void;
}) {
  const [kind, setKind] = useState<PropKind>("window");
  const [propId, setPropId] = useState(yard.props[0]?.id ?? "");
  const [elementId, setElementId] = useState(yard.elements[0]?.id ?? "");

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[14px]">
          <span className="font-medium">Name</span>
          <Input aria-label={`${look.name} name`} value={look.name} onChange={(event) => onName(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          <span className="font-medium">WLED preset slot</span>
          <Input aria-label={`${look.name} slot`} type="number" min={1} max={249} value={look.slot}
            onChange={(event) => onSlot(Number(event.target.value))} />
        </label>
      </div>
      <StyleFields label={look.name} style={look.style} onChange={onStyle} />
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium">Overrides</p>
        <p className="text-[12px] text-quiet">Whole-yard default applies unless a Prop, Prop kind, or Segment overrides it. Prop id wins, then kind, then Segment.</p>
        {look.overrides.length === 0 ? <p className="text-[13px] text-quiet">No overrides. Every Prop and Segment gets the default.</p> : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {look.overrides.map((override, index) => (
              <li key={`${override.propId ?? override.propKind ?? override.elementId}-${index}`} className="flex items-center justify-between gap-2">
                <span>{overrideLabel(override, yard)}</span>
                <Button variant="ghost" onClick={() => onRemoveOverride(index)}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
        {yard.props.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={`${look.name} Prop override`} className={selectClass} value={propId} onChange={(event) => setPropId(event.target.value)}>
              {yard.props.map((prop) => <option key={prop.id} value={prop.id}>{prop.lightName} · {prop.label}</option>)}
            </select>
            <Button variant="outline" disabled={!propId} onClick={() => propId && onAddOverride({ propId, style: { ...look.style } })}>Override this Prop</Button>
          </div>
        ) : <p className="text-[13px] text-quiet">No Props yet. Add Props on a Light, or override a Segment below.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${look.name} Prop kind override`} className={selectClass} value={kind} onChange={(event) => setKind(event.target.value as PropKind)}>
            {PROP_KINDS.map((entry) => <option key={entry} value={entry}>{propKindLabel(entry)}</option>)}
          </select>
          <Button variant="outline" onClick={() => onAddOverride({ propKind: kind, style: { ...look.style } })}>Override this kind</Button>
        </div>
        {yard.elements.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={`${look.name} Segment override`} className={selectClass} value={elementId} onChange={(event) => setElementId(event.target.value)}>
              {yard.elements.map((element) => <option key={element.id} value={element.id}>{element.lightName} · {element.label}</option>)}
            </select>
            <Button variant="outline" disabled={!elementId} onClick={() => elementId && onAddOverride({ elementId, style: { ...look.style } })}>Override this Segment</Button>
          </div>
        ) : null}
      </div>
      <Button variant="outline" onClick={onRemove}>Remove Look</Button>
    </div>
  );
}

function StyleFields({ label, style, onChange }: { label: string; style: LookStyle; onChange: (patch: Partial<LookStyle>) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-[14px]">
        <span className="font-medium">Colour</span>
        <input aria-label={`${label} colour`} type="color" className="h-10 w-16 rounded-md border border-border bg-background"
          value={style.color} onChange={(event) => onChange({ color: event.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        <span className="font-medium">Second colour</span>
        <input aria-label={`${label} second colour`} type="color" className="h-10 w-16 rounded-md border border-border bg-background"
          value={style.color2 ?? "#000000"} onChange={(event) => onChange({ color2: event.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        <span className="font-medium">Effect</span>
        <select aria-label={`${label} effect`} className={selectClass} value={style.fx} onChange={(event) => onChange({ fx: Number(event.target.value) })}>
          {LOOK_EFFECTS.map((effect) => <option key={effect.fx} value={effect.fx}>{effect.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        <span className="font-medium">Palette</span>
        <select aria-label={`${label} palette`} className={selectClass} value={style.pal} onChange={(event) => onChange({ pal: Number(event.target.value) })}>
          {LOOK_PALETTES.map((palette) => <option key={palette.pal} value={palette.pal}>{palette.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        <span className="font-medium">Speed</span>
        <Input aria-label={`${label} speed`} type="number" min={0} max={255} value={style.sx} onChange={(event) => onChange({ sx: Number(event.target.value) })} />
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        <span className="font-medium">Brightness</span>
        <Input aria-label={`${label} brightness`} type="number" min={1} max={255} value={style.bri} onChange={(event) => onChange({ bri: Number(event.target.value) })} />
      </label>
    </div>
  );
}

function ScheduleEditor({
  schedule,
  looks,
  playlists,
  onChange,
}: {
  schedule: NightlySchedule;
  looks: Look[];
  playlists: LookPlaylist[];
  onChange: (next: NightlySchedule) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-5">
      <h2 className="text-[16px] font-medium">Nightly Schedule</h2>
      <p className="text-[13px] text-muted-foreground">
        On at sunset or a clock time, run a Look or playlist, off at a time. Written as WLED timers with NTP and location so each controller keeps time itself.
      </p>
      <label className="flex items-center gap-2 text-[14px]">
        <input type="checkbox" checked={schedule.enabled} onChange={(event) => onChange({ ...schedule, enabled: event.target.checked })} />
        <span>Enable nightly Schedule</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[14px]">
          <span className="font-medium">Turn on</span>
          <select aria-label="Schedule on kind" className={selectClass} value={schedule.on.kind}
            onChange={(event) => onChange({
              ...schedule,
              on: event.target.value === "sunset" ? { kind: "sunset", offsetMinutes: 0 } : { kind: "time", hour: 17, minute: 0 },
            })}>
            <option value="sunset">Sunset</option>
            <option value="time">Clock time</option>
          </select>
        </label>
        {schedule.on.kind === "sunset" ? (
          <label className="flex flex-col gap-1 text-[14px]">
            <span className="font-medium">Minutes from sunset</span>
            <Input aria-label="Sunset offset minutes" type="number" min={-120} max={120} value={schedule.on.offsetMinutes}
              onChange={(event) => onChange({ ...schedule, on: { kind: "sunset", offsetMinutes: Number(event.target.value) } })} />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-[14px]">
            <span className="font-medium">On time</span>
            <Input aria-label="Schedule on time" type="time"
              value={`${String(schedule.on.hour).padStart(2, "0")}:${String(schedule.on.minute).padStart(2, "0")}`}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(":").map(Number);
                onChange({ ...schedule, on: { kind: "time", hour: hour ?? 17, minute: minute ?? 0 } });
              }} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-[14px]">
          <span className="font-medium">Off time</span>
          <Input aria-label="Schedule off time" type="time"
            value={`${String(schedule.off.hour).padStart(2, "0")}:${String(schedule.off.minute).padStart(2, "0")}`}
            onChange={(event) => {
              const [hour, minute] = event.target.value.split(":").map(Number);
              onChange({ ...schedule, off: { hour: hour ?? 23, minute: minute ?? 0 } });
            }} />
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          <span className="font-medium">Run</span>
          <select aria-label="Schedule run" className={selectClass}
            value={schedule.run.kind === "playlist" ? `playlist:${schedule.run.playlistId}` : `look:${schedule.run.lookId}`}
            onChange={(event) => {
              const [kind, id] = event.target.value.split(":");
              onChange({
                ...schedule,
                run: kind === "playlist" ? { kind: "playlist", playlistId: id ?? "" } : { kind: "look", lookId: id ?? "" },
              });
            }}>
            {playlists.map((row) => <option key={row.id} value={`playlist:${row.id}`}>{row.name} (playlist)</option>)}
            {looks.map((row) => <option key={row.id} value={`look:${row.id}`}>{row.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          <span className="font-medium">Latitude</span>
          <Input aria-label="Schedule latitude" type="number" step="0.0001" value={schedule.ntp.latitude}
            onChange={(event) => onChange({ ...schedule, ntp: { ...schedule.ntp, latitude: Number(event.target.value) } })} />
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          <span className="font-medium">Longitude</span>
          <Input aria-label="Schedule longitude" type="number" step="0.0001" value={schedule.ntp.longitude}
            onChange={(event) => onChange({ ...schedule, ntp: { ...schedule.ntp, longitude: Number(event.target.value) } })} />
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          <span className="font-medium">Timezone</span>
          <select aria-label="Schedule timezone" className={selectClass} value={schedule.ntp.tz}
            onChange={(event) => onChange({ ...schedule, ntp: { ...schedule.ntp, tz: Number(event.target.value) } })}>
            {WLED_TIMEZONES.map((zone) => <option key={zone.tz} value={zone.tz}>{zone.label}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

function overrideLabel(override: LookOverride, yard: LooksPayload["yard"]): string {
  if (override.propId) {
    const prop = yard.props.find((row) => row.id === override.propId);
    return prop ? `Prop ${prop.lightName} · ${prop.label}` : `Prop ${override.propId}`;
  }
  if (override.propKind) return `Every ${propKindLabel(override.propKind)}`;
  if (override.elementId) {
    const element = yard.elements.find((row) => row.id === override.elementId);
    return element ? `Segment ${element.lightName} · ${element.label}` : `Segment ${override.elementId}`;
  }
  return "Override";
}
