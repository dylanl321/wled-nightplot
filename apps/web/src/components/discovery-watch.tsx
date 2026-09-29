"use client";

import type { DiscoverRow } from "@nightplot/shared";
import type { NightplotSettings } from "@nightplot/shared";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  discoveryScanInFlight,
  runDiscoveryScan,
  shouldStartDiscoveryScan,
  subscribeDiscoveryScan,
} from "@/lib/discovery-scan";
import { fetchJson } from "@/lib/api";

const DiscoveryContext = createContext<DiscoverRow[] | null>(null);

export function useDiscoveryCandidates(): DiscoverRow[] | null {
  return useContext(DiscoveryContext);
}

export function DiscoveryProvider({ children }: { children: ReactNode }) {
  const [candidates, setCandidates] = useState<DiscoverRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval = 60_000;
    let lastScan = 0;
    void fetchJson<{ settings: NightplotSettings }>("/api/settings").then(({ settings }) => {
      if (cancelled) return;
      interval = settings.findIntervalSeconds * 1000;
      document.documentElement.dataset.theme = settings.appearance;
      tick();
    }).catch(() => { tick(); });
    const unsub = subscribeDiscoveryScan((rows) => {
      if (!cancelled) setCandidates(rows);
    });

    function tick() {
      if (cancelled) return;
      if (!interval || (lastScan && Date.now() - lastScan < interval)) return;
      if (
        !shouldStartDiscoveryScan({
          visibility: document.visibilityState,
          inFlight: discoveryScanInFlight(),
        })
      ) {
        return;
      }
      lastScan = Date.now();
      void runDiscoveryScan();
    }

    const id = window.setInterval(tick, 1000);
    function onVisible() {
      if (document.visibilityState === "visible") { lastScan = 0; tick(); }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      unsub();
    };
  }, []);

  return <DiscoveryContext.Provider value={candidates}>{children}</DiscoveryContext.Provider>;
}
