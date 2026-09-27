import Link from "next/link";
import { Button } from "@/components/ui/button";

function sameCopy(detail: string, title: string): boolean {
  const fold = (value: string) => value.trim().replace(/\.+$/u, "").toLowerCase();
  return fold(detail) === fold(title);
}

export function LightUnavailable({
  kind,
  detail,
  listed = false,
}: {
  kind: "missing" | "load-failed";
  detail?: string;
  listed?: boolean;
}) {
  const title =
    kind === "missing" ? "That Light is not on Lights" : "This Light did not load";
  const body =
    kind === "missing"
      ? "It may have been removed, or this address never enrolled. Nothing was sent to a controller."
      : "Enrolled Lights stay listed. This is not a claim that the configure server is down. Open another Light from the rail, or go back to Lights.";

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-4 px-5 py-10 sm:px-8">
      <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{title}</h1>
      <p className="text-[15px] leading-6 text-[#c9c3b8]">{body}</p>
      {kind === "missing" && listed ? (
        <p className="text-[15px] leading-6 text-[#c9c3b8]">
          Enrolled Lights stay listed. This is not a claim that the configure
          server is down.
        </p>
      ) : null}
      {detail && !sameCopy(detail, title) ? (
        <p className="font-mono text-xs text-quiet">{detail}</p>
      ) : null}
      <Button asChild className="w-fit">
        <Link href="/">Back to Lights</Link>
      </Button>
    </div>
  );
}
