import type { Light, LightsPayload, Prop, PropAttachment, YardCheckResult } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { ServerDown } from "@/components/server-down";
import { YardHome } from "@/components/yard-home";
import { fetchJson } from "@/lib/api";

export const dynamic = "force-dynamic";

type PropsPayload = { props: Prop[]; attachments: PropAttachment[] };
type LooksPayload = { looks: { id: string }[]; schedule: unknown | null };

export default async function YardPage() {
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
  const roster: Pick<Light, "id" | "name" | "outputs">[] = lights.value.lights.map((light) => ({
    id: light.id,
    name: light.name,
    outputs: light.outputs,
  }));

  return (
    <AppShell lights={lights.value.lights} lightCount={lights.value.lights.length} nav="lights" sessions={lights.value.sessions}>
      <YardHome
        props={propsResult.status === "fulfilled" ? propsResult.value.props : []}
        attachments={attachments}
        lights={roster}
        looksReady={Boolean(looks && looks.looks.length > 0 && looks.schedule)}
        yardClear={yardIsClear(yard)}
        looksKnown={looksResult.status === "fulfilled"}
        yardKnown={yardResult.status === "fulfilled"}
      />
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
