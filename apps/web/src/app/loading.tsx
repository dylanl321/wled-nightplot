import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell lightCount={0} nav="lights">
      <div className="flex flex-1 flex-col gap-3 px-5 py-10 sm:px-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Lights</h1>
        <p className="text-muted-foreground">Loading Lights…</p>
      </div>
    </AppShell>
  );
}
