import { AppShell } from "@/components/app-shell";
import { LedLoader } from "@/components/ui/led-loader";

export default function YardLoading() {
  return (
    <AppShell lightCount={0} nav="yard">
      <div className="flex flex-1 flex-col gap-3 px-5 py-10 sm:px-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Yard check</h1>
        <LedLoader label="Loading Yard" />
      </div>
    </AppShell>
  );
}
