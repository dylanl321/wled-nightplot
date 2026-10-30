"use client";

import type { LightView, SyncRow } from "@nightplot/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchJson, postJson } from "@/lib/api";

type Role = "leader" | "follower" | "off" | "skip";
type ReadRow = { lightId: string; lightName: string; sendGroups: number[] | null; receiveGroups: number[] | null };
type UdpResult = { rows: SyncRow[]; message: string; caption: string };

const GROUPS = [1, 2, 3, 4, 5, 6, 7, 8];
const ROLE_LABEL: Record<Role, string> = { leader: "Leader", follower: "Follower", off: "Leave group", skip: "Don’t change" };

function groupsCopy(groups: number[] | null): string {
  if (groups === null) return "unknown";
  return groups.length ? groups.join(", ") : "none";
}

/** WLED's own UDP broadcast sync: Nightplot sets the group once; the controllers follow each other after that. */
export function UdpSyncSection({ lights }: { lights: LightView[] }) {
  const [group, setGroup] = useState(2);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [reads, setReads] = useState<ReadRow[] | null>(null);
  const [result, setResult] = useState<UdpResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = Object.entries(roles).filter(([, role]) => role !== "skip");
  const leaders = chosen.filter(([, role]) => role === "leader").length;

  function setRole(id: string, role: Role) {
    setRoles((current) => {
      const next = { ...current, [id]: role };
      if (role === "leader") for (const key of Object.keys(next)) if (key !== id && next[key] === "leader") next[key] = "follower";
      return next;
    });
  }

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try { await work(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "WLED sync did not finish. Check each Light before retrying."); }
    finally { setBusy(null); }
  }

  async function read() {
    await run("Reading WLED sync…", async () => {
      setReads((await fetchJson<{ rows: ReadRow[] }>("/api/sync/udp")).rows);
    });
  }

  async function save() {
    await run(`Setting WLED sync group ${group}…`, async () => {
      const res = await postJson<UdpResult>("/api/sync/udp", { group, roles: Object.fromEntries(chosen) });
      if (!res.ok) throw new Error(res.data.message ?? "WLED sync was refused. Nothing was sent.");
      setResult(res.data);
      setReads((await fetchJson<{ rows: ReadRow[] }>("/api/sync/udp")).rows);
    });
  }

  return <div className="flex flex-col gap-3 border-t border-border pt-5">
    <h2 className="text-[16px] font-medium">Keep in step with WLED sync</h2>
    <p className="text-[13px] text-muted-foreground">WLED’s own UDP broadcast: when the leader’s brightness, colour, effect or palette changes, followers in the same group copy it, with or without Nightplot running. Followers keep their own Segment ranges. Lights must share a subnet. Every fresh WLED listens to group 1, so a group from 2 to 8 keeps this pairing to the Lights you choose. Preview and Blink on a leader are not broadcast.</p>
    <label className="flex items-center gap-3 text-[14px]">
      <span className="font-medium">Group</span>
      <select aria-label="Sync group" className="h-10 rounded-md border border-border bg-background px-3"
        value={group} onChange={(event) => setGroup(Number(event.target.value))}>
        {GROUPS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
      </select>
    </label>
    <ul className="flex flex-col gap-2 text-[14px]">
      {lights.map((light) => {
        const current = reads?.find((entry) => entry.lightId === light.id);
        return <li key={light.id} className="flex flex-wrap items-center gap-3">
          <span className="min-w-32 font-medium">{light.name}</span>
          <select aria-label={`${light.name} role`} className="h-9 rounded-md border border-border bg-background px-2"
            value={roles[light.id] ?? "skip"} onChange={(event) => setRole(light.id, event.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
          </select>
          {current ? <span className="text-[12px] text-quiet">sends {groupsCopy(current.sendGroups)} · receives {groupsCopy(current.receiveGroups)}</span> : null}
        </li>;
      })}
    </ul>
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" disabled={Boolean(busy)} onClick={read}>Read WLED sync</Button>
      <Button disabled={Boolean(busy) || chosen.length === 0 || leaders > 1} onClick={save}>Set group {group}</Button>
    </div>
    <p className="text-[12px] text-quiet">Each changed Light gets a safety backup of its configuration and presets first.</p>
    {busy ? <p className="text-[13px] text-muted-foreground">{busy}</p> : null}
    {error ? <p role="alert" className="text-[13px] text-[#f0a3a3]">{error}</p> : null}
    {result ? <div className="flex flex-col gap-2 rounded-[14px] border border-border p-4 text-[13px]">
      <p className="font-medium">{result.message}</p>
      <ul className="flex flex-col gap-1">{result.rows.map((row) => <li key={row.lightId}><span className="font-medium">{row.lightName}</span> · {row.detail}</li>)}</ul>
      <p className="text-[12px] text-quiet">{result.caption}</p>
    </div> : null}
  </div>;
}
