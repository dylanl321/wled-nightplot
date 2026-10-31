import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell lightCount={0} nav="home">
      <div className="flex flex-1 flex-col gap-3 px-5 py-10 sm:px-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Your yard</h1>
        <p className="text-muted-foreground">Loading…</p>
      </div>
    </AppShell>
  );
}
