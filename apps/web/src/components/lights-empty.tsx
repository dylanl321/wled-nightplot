import Link from "next/link";
import { StripBeads } from "@/components/strip-beads";
import { Button } from "@/components/ui/button";

export function LightsEmpty() {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-5 py-8 sm:px-8 sm:py-10">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Lights</h1>
          <p className="text-muted-foreground">
            Nothing on this network has been added yet.
          </p>
        </div>
        <Button asChild className="mt-3 sm:ml-auto sm:mt-0">
          <Link href="/discover">Find Lights</Link>
        </Button>
      </div>

      <div className="flex justify-center rounded-[14px] border border-border bg-card px-3.5 py-5">
        <StripBeads
          id="empty"
          count={16}
          color={() => null}
          pitch={18}
          gutter={0}
          top={3}
          bottom={3}
          ariaLabel="Empty strip — no Lights enrolled"
        />
      </div>

      <div className="flex flex-col gap-2.5">
        <h2 className="text-2xl font-semibold tracking-[-0.01em]">No Lights yet</h2>
        <p className="max-w-prose text-[15px] leading-6 text-[#c9c3b8]">
          Nightplot finds WLED controllers on your home network. Nothing changes
          on any strip until you add one. Elements — contiguous ranges on a
          Light — appear after that.
        </p>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Button asChild size="lg" className="sm:min-w-[160px]">
          <Link href="/discover">Find Lights</Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="sm:min-w-[160px]">
          <Link href="/discover#address">Type an address</Link>
        </Button>
      </div>

      <div className="rounded-xl border border-dashed border-[#3a4150] px-4 py-4 text-[13px] leading-5 text-quiet">
        Candidates will land in a tray here. Discovery is not wired, so the tray
        stays empty on purpose.
      </div>
    </div>
  );
}
