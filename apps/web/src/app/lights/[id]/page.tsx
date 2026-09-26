export const dynamic = "force-dynamic";

import type { LightDetail as LightDetailPayload, LightsPayload } from "@nightplot/shared";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LightDetail } from "@/components/light-detail";
import { ServerDown } from "@/components/server-down";
import { apiUrl } from "@/lib/api";

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
    requested === "ranges" ? "ranges" : requested === "live" ? "live" : "inspect";
  let lights: LightsPayload | null = null;
  let detail: LightDetailPayload | null = null;
  let missing = false;
  let error: string | undefined;

  try {
    const [lightsRes, detailRes] = await Promise.all([
      fetch(apiUrl("/api/lights"), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }),
      fetch(apiUrl(`/api/lights/${id}`), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }),
    ]);
    if (detailRes.status === 404) {
      missing = true;
    } else if (!lightsRes.ok || !detailRes.ok) {
      error = "The configure API did not return this Light.";
    } else {
      lights = (await lightsRes.json()) as LightsPayload;
      detail = (await detailRes.json()) as LightDetailPayload;
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Unknown error";
  }

  if (missing) notFound();

  if (!lights || !detail) {
    return (
      <AppShell lightCount={0} nav="light" activeLightId={id}>
        <ServerDown detail={error} />
      </AppShell>
    );
  }

  return (
    <AppShell
      lights={lights.lights}
      lightCount={lights.lights.length}
      nav="light"
      activeLightId={id}
      sessions={lights.sessions}
    >
      <LightDetail initial={detail} mode={mode} />
    </AppShell>
  );
}
