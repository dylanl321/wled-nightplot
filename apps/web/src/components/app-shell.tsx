import type { LightView } from "@nightplot/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { AllOffControl } from "@/components/all-off-control";
import { MiniStrip } from "@/components/mini-strip";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  lights?: LightView[];
  lightCount: number;
  nav: "lights" | "discover" | "light";
  activeLightId?: string;
};

export function AppShell({
  children,
  lights = [],
  lightCount,
  nav,
  activeLightId,
}: AppShellProps) {
  const online = lights.filter((light) => light.reachability === "online" && light.on).length;
  const missing = lights.filter((light) => light.reachability === "no-answer").length;
  const allOffCaption =
    lightCount === 0
      ? "No Lights to turn off yet"
      : missing
        ? `${online} on · ${missing} not answering`
        : `${lightCount} Light${lightCount === 1 ? "" : "s"}`;

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-border bg-rail lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <Brand markClassName="h-3 w-11" />
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-1">
          <NavLink href="/" active={nav === "lights"}>
            <span>All Lights</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {lightCount}
            </span>
          </NavLink>
          {lights.map((light) => (
            <Link
              key={light.id}
              href={`/lights/${light.id}`}
              className={cn(
                "flex flex-col gap-1.5 rounded-md px-2.5 py-2.5 hover:bg-secondary/60",
                activeLightId === light.id &&
                  "bg-secondary font-medium shadow-[inset_2px_0_0_#d4a574]",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className="size-1.5 rounded-full"
                  style={{
                    background:
                      light.reachability === "no-answer" ? "#e07070" : "#7ee0d0",
                  }}
                />
                <span className="truncate">{light.name}</span>
                <span
                  className={cn(
                    "ml-auto text-[11px]",
                    light.reachability === "no-answer"
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {light.reachability === "no-answer"
                    ? "No answer"
                    : light.on
                      ? "On"
                      : "Off"}
                </span>
              </div>
              <MiniStrip
                id={`nav-${light.id}`}
                bead={light.bead}
                count={40}
                pitch={4.8}
              />
            </Link>
          ))}
          <NavLink href="/discover" active={nav === "discover"}>
            + Add a Light
          </NavLink>
        </nav>
        <div className="max-h-[55%] overflow-y-auto border-t border-border p-4">
          <AllOffControl size="sidebar" caption={allOffCaption} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] items-center gap-2.5 border-b border-border px-5 lg:hidden">
          <Brand markClassName="h-2.5 w-9" />
        </header>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        <div className="border-t border-border bg-rail px-4 pb-7 pt-3 lg:hidden">
          <AllOffControl size="thumb" caption={allOffCaption} />
        </div>
      </div>
    </div>
  );
}

function Brand({ markClassName }: { markClassName: string }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-inherit">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.svg" alt="" className={markClassName} />
      <span className="font-serif text-[17px] text-primary">Nightplot</span>
    </Link>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center rounded-md px-2.5 py-2.5 text-[14px]",
        active
          ? "bg-secondary font-medium shadow-[inset_2px_0_0_#d4a574]"
          : "text-foreground hover:bg-secondary/60",
      )}
    >
      {children}
    </Link>
  );
}
