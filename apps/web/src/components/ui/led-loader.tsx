import { cn } from "@/lib/utils";

/** Reusable, accessible strip-shaped loading indicator. Decorative beads are hidden from assistive tech. */
export function LedLoader({ label = "Loading…", className }: { label?: string; className?: string }) {
  return <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-2 text-[13px] text-muted-foreground", className)}>
    <span aria-hidden="true" className="inline-flex items-center gap-[5px]">
      {Array.from({ length: 7 }, (_, index) => <span key={index}
        className="nightplot-loading-led size-[7px] rounded-full bg-primary"
        style={{ animationDelay: `${index * 110}ms` }} />)}
    </span>
    {label}
  </span>;
}
