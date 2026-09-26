"use client";

import type { DiscoverRow, LightView } from "@nightplot/shared";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MiniStrip } from "@/components/mini-strip";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";

export function DiscoverPanel({
  initialCandidates,
  enrolled,
}: {
  initialCandidates: DiscoverRow[];
  enrolled: LightView[];
}) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [rows, setRows] = useState<DiscoverRow[]>(initialCandidates);
  const [busy, setBusy] = useState<"scan" | "probe" | "add" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const found = useMemo(
    () => rows.filter((row) => row.status === "found"),
    [rows],
  );
  const rest = useMemo(
    () => rows.filter((row) => row.status !== "found"),
    [rows],
  );

  async function scan() {
    setBusy("scan");
    setNotice(null);
    const res = await postJson<{ candidates: DiscoverRow[] }>("/api/discover");
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Find Lights failed.");
      return;
    }
    setRows(res.data.candidates);
    if (!res.data.candidates.some((row) => row.status === "found")) {
      setNotice("Nothing new answered. Type an address if mDNS is hidden.");
    }
  }

  async function checkAddress() {
    const host = address.trim();
    if (!host) {
      setNotice("Type a host or host:port.");
      return;
    }
    setBusy("probe");
    setNotice(null);
    const res = await postJson<{ candidate: DiscoverRow }>("/api/discover/probe", {
      host,
    });
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Nothing added.");
      return;
    }
    const row = res.data.candidate;
    setRows((current) => [row, ...current.filter((item) => item.key !== row.key)]);
    if (row.status === "rejected" || row.status === "already-added") {
      setNotice(row.reason ?? "Nothing added.");
    }
  }

  async function addHost(host: string) {
    setBusy("add");
    setNotice(null);
    const res = await postJson<{ light: LightView }>("/api/lights", { host });
    setBusy(null);
    if (!res.ok) {
      setNotice(res.data.message ?? "Nothing added.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-xl border border-[#3a4150] bg-[#12141a] p-[18px]">
        <p className="text-[15px] leading-6 text-[#c9c3b8]">
          Candidates arrive as each one answers. Add fails closed — a snapshot
          that can’t be read saves nothing. Public addresses are refused before
          a probe.
        </p>
        <Button
          type="button"
          size="lg"
          className="w-fit"
          disabled={busy !== null}
          onClick={() => void scan()}
        >
          {busy === "scan" ? "Looking…" : "Find Lights"}
        </Button>
      </div>

      {found.map((row) => (
        <FoundCard
          key={row.key}
          row={row}
          busy={busy !== null}
          onAdd={() => void addHost(row.displayHost)}
        />
      ))}

      {rest.length > 0 ? (
        <div className="flex flex-col rounded-xl border border-border">
          {rest.map((row, index) => (
            <div
              key={`${row.key}-${row.status}`}
              className={`grid gap-4 px-4 py-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-center ${
                index < rest.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <span
                className={`font-mono text-xs ${
                  row.reasonCode === "disallowed-address"
                    ? "text-destructive"
                    : row.reasonCode === "probe-failed" || row.reasonCode === "not-wled"
                      ? "text-primary"
                      : "text-muted-foreground"
                }`}
              >
                {row.displayHost}
              </span>
              <span className="text-sm text-[#c9c3b8]">
                {row.name ?? row.reason ?? row.status}
              </span>
              <span
                className={`text-xs ${
                  row.status === "already-added"
                    ? "text-quiet"
                    : row.reasonCode === "disallowed-address"
                      ? "text-destructive"
                      : "text-primary"
                }`}
              >
                {row.status === "already-added"
                  ? "Already added"
                  : row.reasonCode === "disallowed-address"
                    ? "Refused"
                    : row.reasonCode === "not-wled"
                      ? "Probe failed"
                      : "Probe failed"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div
        id="address"
        className="flex max-w-[320px] flex-col gap-3.5 rounded-xl border border-border bg-[#0e1014] p-[18px]"
      >
        <span className="font-medium">Type an address</span>
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="host or host:port"
          autoComplete="off"
          spellCheck={false}
          className="h-[42px] rounded-lg border border-[#3a4150] bg-card px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void checkAddress()}
        >
          {busy === "probe" ? "Checking…" : "Check"}
        </Button>
        <Button
          type="button"
          disabled={busy !== null}
          onClick={() => void addHost(address.trim())}
        >
          {busy === "add" ? "Adding…" : "Check and add"}
        </Button>
        <p className="text-xs leading-5 text-quiet">
          Some networks hide mDNS. An address always works; host:port too.
        </p>
      </div>

      {enrolled.length > 0 ? (
        <p className="text-xs text-quiet">
          {enrolled.length} Light{enrolled.length === 1 ? "" : "s"} already on
          the rack. A duplicate host is refused.
        </p>
      ) : null}

      {notice ? (
        <div className="max-w-[520px] rounded-md border-l-2 border-destructive bg-[#1a1113] px-3 py-3">
          <p className="font-medium text-destructive">Nothing added</p>
          <p className="mt-1 text-xs leading-5 text-[#c9c3b8]">{notice}</p>
        </div>
      ) : null}
    </div>
  );
}

function FoundCard({
  row,
  busy,
  onAdd,
}: {
  row: DiscoverRow;
  busy: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-3.5 rounded-xl border border-[#3a4150] bg-[#12141a] p-[18px]">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="text-lg font-medium">{row.name ?? "WLED"}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {row.displayHost}
        </span>
        <span className="ml-auto text-xs text-online">Answered · via {row.via}</span>
      </div>
      <div className="rounded-lg bg-card p-3.5">
        <MiniStrip
          id={`cand-${row.key}`}
          bead={row.bead}
          count={Math.min(row.ledCount ?? 60, 60)}
          pitch={8}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Fact label="LEDs" value={row.ledCount != null ? String(row.ledCount) : "—"} />
        <Fact label="Firmware" value={row.firmware ?? "—"} />
        <Fact label="MAC" value={row.mac ?? "—"} />
        <Fact label="Via" value={row.via} />
      </div>
      <div className="flex items-center gap-2.5">
        <Button
          type="button"
          className="ml-auto"
          disabled={busy}
          onClick={onAdd}
        >
          Add {row.name ?? row.displayHost}
        </Button>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-quiet">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
