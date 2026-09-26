import { AppShell } from "@/components/app-shell";
import { DiscoverForm } from "@/components/discover-form";

export default function DiscoverPage() {
  return (
    <AppShell lightCount={0} nav="discover">
      <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-6 px-5 py-8 sm:px-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">
            Add a Light
          </h1>
          <p className="text-muted-foreground">
            Find Lights is not wired. Nothing is being scanned on this network.
          </p>
        </div>
        <DiscoverForm />
      </div>
    </AppShell>
  );
}
