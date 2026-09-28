import type { LightView } from "@nightplot/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { AllOffControl, type LiveHint } from "@/components/all-off-control";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  lights?: LightView[];
  lightCount: number;
  nav: "lights" | "discover" | "light" | "catalog";
  activeLightId?: string;
  sessions?: LiveHint[];
};

export function AppShell({
  children,
  lights = [],
  nav,
  sessions = [],
}: AppShellProps) {
  const lightsActive = nav === "lights" || nav === "light" || nav === "discover";

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="hidden h-14 items-center gap-7 border-b border-border bg-rail px-6 lg:flex">
        <Brand markClassName="h-3 w-11" />
        <nav className="flex items-center gap-1">
          <NavLink href="/" active={lightsActive}>
            Lights
          </NavLink>
          <NavLink href="/led-products" active={nav === "catalog"}>
            LED products
          </NavLink>
        </nav>
        <div className="ml-auto">
          <AllOffControl size="bar" lights={lights} sessions={sessions} />
        </div>
      </header>

      <header className="flex h-[52px] items-center gap-2.5 border-b border-border px-5 lg:hidden">
        <Brand markClassName="h-2.5 w-9" />
      </header>

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>

      <div className="border-t border-border bg-rail px-4 pb-7 pt-3 lg:hidden">
        <AllOffControl size="thumb" lights={lights} sessions={sessions} />
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
        "rounded-md px-3 py-1.5 text-[14px]",
        active ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary/60",
      )}
    >
      {children}
    </Link>
  );
}
