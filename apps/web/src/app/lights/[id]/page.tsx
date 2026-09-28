export const dynamic = "force-dynamic";

import type { LightDetail as LightDetailPayload, LightsPayload } from "@nightplot/shared";
import { AppShell } from "@/components/app-shell";
import { LightDetail } from "@/components/light-detail";
import { LightUnavailable } from "@/components/light-unavailable";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";
import { inspectPageModel } from "@/lib/inspect-page-load";

export default async function LightPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tab =
    query.tab === "settings" || query.tab === "elements"
      ? query.tab
      : query.mode === "ranges" || query.mode === "live"
        ? "elements"
        : query.mode === "inspect" || query.mode === "strip" || query.mode === "safe"
          ? "settings"
          : "elements";

  const [lightsResult, detailResult] = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<LightDetailPayload>(`/api/lights/${id}`),
  ]);
  const model = inspectPageModel(lightsResult, detailResult);

  if (model.kind === "server-down") {
    return (
      <AppShell lightCount={0} nav="light" activeLightId={id}>
        <ServerDown detail={model.error} />
      </AppShell>
    );
  }

  if (model.kind === "detail-miss") {
    return (
      <AppShell
        lights={model.lights.lights}
        lightCount={model.lights.lights.length}
        nav="light"
        activeLightId={id}
        sessions={model.lights.sessions}
      >
        <LightUnavailable
          kind={model.missing ? "missing" : "load-failed"}
          detail={model.error}
          listed
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      lights={model.lights.lights}
      lightCount={model.lights.lights.length}
      nav="light"
      activeLightId={id}
      sessions={model.lights.sessions}
    >
      <LightDetail initial={model.detail} tab={tab} mode={query.mode === "inspect" || query.mode === "ranges" || query.mode === "live" || query.mode === "safe" || query.mode === "strip" ? query.mode : undefined} />
    </AppShell>
  );
}
