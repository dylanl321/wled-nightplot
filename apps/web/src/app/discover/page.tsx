import type { DiscoverRow, LightsPayload } from "@nightplot/shared";

export const dynamic = "force-dynamic";
import { AppShell } from "@/components/app-shell";
import { DiscoverPanel } from "@/components/discover-panel";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";

export default async function DiscoverPage() {
  let lights: LightsPayload | null = null;
  let session: { candidates: DiscoverRow[] } | null = null;
  let error: string | undefined;

  try {
    [lights, session] = await Promise.all([
      fetchJson<LightsPayload>("/api/lights"),
      fetchJson<{ candidates: DiscoverRow[] }>("/api/discover"),
    ]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Unknown error";
  }

  if (!lights) {
    return (
      <AppShell lightCount={0} nav="discover">
        <ServerDown detail={error} />
      </AppShell>
    );
  }

  return (
    <AppShell
      lights={lights.lights}
      lightCount={lights.lights.length}
      nav="discover"
      sessions={lights.sessions}
    >
      <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-6 px-5 py-8 sm:px-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">
            Add a Light
          </h1>
          <p className="text-muted-foreground">
            Looking on this link. Find probes up to four collected hosts at a
            time; a dead probe stops in 3 s. Type host:port if find has no port
            or the list comes back empty.
          </p>
        </div>
        <DiscoverPanel
          initialCandidates={session?.candidates ?? []}
          enrolled={lights.lights}
        />
      </div>
    </AppShell>
  );
}
