import { AppShell } from "@/components/app-shell";
import { LedLoader } from "@/components/ui/led-loader";

export default function BackupsLoading() {
  return (
    <AppShell lightCount={0} nav="backups">
      <div className="flex flex-1 flex-col gap-3 px-5 py-10 sm:px-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Backups</h1>
        <LedLoader label="Loading backups" />
      </div>
    </AppShell>
  );
}
