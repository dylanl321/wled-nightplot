"use client";

import type { DiscoverRow } from "@nightplot/shared";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DISCOVERY_SCAN_INTERVAL_MS,
  discoveryScanInFlight,
  runDiscoveryScan,
  shouldStartDiscoveryScan,
  subscribeDiscoveryScan,
} from "@/lib/discovery-scan";

const DiscoveryContext = createContext<DiscoverRow[] | null>(null);

export function useDiscoveryCandidates(): DiscoverRow[] | null {
  return useContext(DiscoveryContext);
}

export function DiscoveryProvider({ children }: { children: ReactNode }) {
  const [candidates, setCandidates] = useState<DiscoverRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsub = subscribeDiscoveryScan((rows) => {
      if (!cancelled) setCandidates(rows);
    });

    function tick() {
      if (cancelled) return;
      if (
        !shouldStartDiscoveryScan({
          visibility: document.visibilityState,
          inFlight: discoveryScanInFlight(),
        })
      ) {
        return;
      }
      void runDiscoveryScan();
    }

    tick();
    const id = window.setInterval(tick, DISCOVERY_SCAN_INTERVAL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") tick();
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
