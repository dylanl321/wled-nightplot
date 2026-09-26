import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export default function LightNotFound() {
  return (
    <AppShell lightCount={0} nav="light">
      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-4 px-5 py-10 sm:px-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">
          That Light is not on Lights
        </h1>
        <p className="text-[15px] leading-6 text-[#c9c3b8]">
          It may have been removed, or this address never enrolled. Nothing was
          sent to a controller.
        </p>
        <Button asChild className="w-fit">
          <Link href="/">Back to Lights</Link>
        </Button>
      </div>
    </AppShell>
  );
}
