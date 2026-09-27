import { AppShell } from "@/components/app-shell";
import { LightUnavailable } from "@/components/light-unavailable";

export default function LightNotFound() {
  return (
    <AppShell lightCount={0} nav="light">
      <LightUnavailable kind="missing" />
    </AppShell>
  );
}
