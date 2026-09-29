import { cn } from "@/lib/utils";

const BEADS = [0, 1, 2, 3, 4] as const;

export function GlowingLedLoader({
  label = "Working",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn("inline-flex items-center gap-2 text-[13px] text-muted-foreground", className)}
    >
      <span className="sr-only">{label}</span>
      <span className="flex items-center gap-1.5" aria-hidden="true">
        {BEADS.map((index) => (
          <span
            key={index}
            className="nightplot-led-glow h-2.5 w-2.5 rounded-full bg-primary motion-reduce:animate-none motion-reduce:opacity-70 motion-reduce:shadow-none"
            style={{ animationDelay: `${index * 140}ms` }}
          />
        ))}
      </span>
    </div>
  );
}
