import { AppShell } from "@/components/app-shell";

export default function LedProductsLoading() {
  return (
    <AppShell lightCount={0} nav="catalog">
      <div className="flex flex-1 flex-col gap-3 px-5 py-10 sm:px-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">LED products</h1>
        <p className="text-muted-foreground">Loading shared recipes…</p>
      </div>
    </AppShell>
  );
}
