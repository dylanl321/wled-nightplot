import type { LightsPayload, LooksDocument, Prop, PropAttachment, YardCheckResult } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { ServerDown } from "@/components/server-down";
import { YardEditor, type YardLight } from "@/components/yard-editor/yard-editor";
import { redirect } from "next/navigation";
import { fetchJson } from "@/lib/api";

export const dynamic = "force-dynamic";

type PropsPayload = { props: Prop[]; attachments: PropAttachment[] };
type LooksPayload = LooksDocument;
type Query = { view?: string; prop?: string; look?: string; fold?: string };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function YardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query: Query = { view: one(params.view), prop: one(params.prop), look: one(params.look), fold: one(params.fold) };
  // A Look opens on the Looks page, which draws the yard in its colours.
  if (query.look) redirect(`/looks/${encodeURIComponent(query.look)}`);
  const lightsResult = await Promise.allSettled([fetchJson<LightsPayload>("/api/lights")]);
  const lights = lightsResult[0];
  if (!lights || lights.status === "rejected") {
    return (
      <AppShell lightCount={0} nav="lights">
        <ServerDown detail={lights?.status === "rejected" && lights.reason instanceof Error ? lights.reason.message : "Could not load the yard."} />
      </AppShell>
    );
  }

  const [propsResult, looksResult, yardResult] = await Promise.allSettled([
    fetchJson<PropsPayload>("/api/props"),
    fetchJson<LooksPayload>("/api/looks"),
    fetchJson<YardCheckResult>("/api/yard-check"),
  ]);

  const attachments = propsResult.status === "fulfilled" ? propsResult.value.attachments : [];
  const looks = looksResult.status === "fulfilled" ? looksResult.value : null;
  const yard = yardResult.status === "fulfilled" ? yardResult.value : null;
  const roster: YardLight[] = lights.value.lights.map((light) => ({
    id: light.id,
    name: light.name,
    outputs: light.outputs,
    ledCount: light.ledCount,
    lastSnapshot: light.lastSnapshot,
    elementCount: light.elementCount,
  }));

  return (
    <AppShell lights={lights.value.lights} lightCount={lights.value.lights.length} nav="home" sessions={lights.value.sessions} immersive>
      <div className="flex h-dvh min-h-0 flex-col">
        <YardEditor
          props={propsResult.status === "fulfilled" ? propsResult.value.props : []}
          attachments={attachments}
          lights={roster}
          lightViews={lights.value.lights}
          sessions={lights.value.sessions ?? []}
          looks={looks ? { version: 1, looks: looks.looks, playlists: looks.playlists ?? [], schedule: looks.schedule ?? null } : null}
          looksReady={Boolean(looks && looks.looks.length > 0 && looks.schedule)}
          yardClear={yardIsClear(yard)}
          query={query}
        />
      </div>
    </AppShell>
  );
}

function yardIsClear(yard: YardCheckResult | null): boolean {
  if (!yard || yard.rows.length === 0) return false;
  return yard.rows.every((row) =>
    row.reachability === "online" &&
    row.looks.status === "match" &&
    row.schedule.status === "match" &&
    row.outputs.status === "match",
  );
}
