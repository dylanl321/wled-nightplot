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
  searchParams: Promise<{ mode?: string }>;
}) {
  const { id } = await params;
  const requested = (await searchParams).mode;
  const mode =
    requested === "ranges"
      ? "ranges"
      : requested === "live"
        ? "live"
        : requested === "safe"
          ? "safe"
          : requested === "strip"
            ? "strip"
            : "inspect";

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
      <LightDetail initial={model.detail} mode={mode} />
    </AppShell>
  );
}
