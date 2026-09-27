import type { DiscoverRow, LightsPayload } from "@nightplot/shared";

export const dynamic = "force-dynamic";
import { AppShell } from "@/components/app-shell";
import { DiscoverPanel } from "@/components/discover-panel";
import { ServerDown } from "@/components/server-down";
import { fetchJson } from "@/lib/api";
import { discoverPageModel } from "@/lib/discover-page-load";

export default async function DiscoverPage() {
  const [lightsResult, discoverResult] = await Promise.allSettled([
    fetchJson<LightsPayload>("/api/lights"),
    fetchJson<{ candidates: DiscoverRow[] }>("/api/discover"),
  ]);
  const model = discoverPageModel(lightsResult, discoverResult);

  if (model.kind === "server-down") {
    return (
      <AppShell lightCount={0} nav="discover">
        <ServerDown detail={model.error} />
      </AppShell>
    );
  }

  return (
    <AppShell
      lights={model.lights.lights}
      lightCount={model.lights.lights.length}
      nav="discover"
      sessions={model.lights.sessions}
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
          initialCandidates={model.candidates}
          enrolled={model.lights.lights}
          findError={model.findError}
        />
      </div>
    </AppShell>
  );
}
