import type { LightView } from "@nightplot/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { AllOffControl, type LiveHint } from "@/components/all-off-control";
import { DiscoveryProvider } from "@/components/discovery-watch";
import { PhoneChrome } from "@/components/phone-chrome";
import { ShortcutOverlay } from "@/components/shortcut-overlay";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  lights?: LightView[];
  lightCount: number;
  nav: "home" | "lights" | "discover" | "light" | "catalog" | "backups" | "sync" | "looks" | "yard" | "settings";
  activeLightId?: string;
  sessions?: LiveHint[];
  /** Prop drawing and the New prop wizard fill the phone. All Off and the bottom bar stay off those screens. */
  immersive?: boolean;
};

export function AppShell({
  children,
  lights = [],
  nav,
  sessions = [],
  immersive = false,
}: AppShellProps) {
  const lightsActive = nav === "lights" || nav === "light";
  const moreActive = nav === "discover" || nav === "catalog" || nav === "backups" || nav === "sync" || nav === "settings";

  return (
    <DiscoveryProvider>
    <div className={cn(
      "flex min-h-dvh flex-col bg-background text-foreground",
      immersive ? "[--phone-chrome:0px]" : "[--phone-chrome:calc(12rem+env(safe-area-inset-bottom))] lg:[--phone-chrome:0px]",
    )}>
      {immersive ? null : <header
        className="flex h-auto min-h-14 items-center gap-2.5 border-b border-border px-5 lg:h-14 lg:gap-7 lg:bg-rail lg:px-6"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "max(1.25rem, env(safe-area-inset-left))",
          paddingRight: "max(1.25rem, env(safe-area-inset-right))",
        }}
      >
        <Brand markClassName="h-2.5 w-9 lg:h-3 lg:w-11" />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Nightplot">
          <NavLink href="/" active={nav === "home"}>Yard</NavLink>
          <NavLink href="/looks" active={nav === "looks"}>Looks</NavLink>
          <NavLink href="/lights" active={lightsActive}>Lights</NavLink>
          <NavLink href="/yard" active={nav === "yard"}>Check</NavLink>
          <details className="relative">
            <summary
              className={cn(
                "cursor-pointer list-none rounded-md px-3 py-1.5 text-[14px] [&::-webkit-details-marker]:hidden",
                moreActive ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              More
            </summary>
            <div className="absolute left-0 top-full z-40 mt-1 flex min-w-44 flex-col rounded-lg border border-border bg-background p-1 shadow-lg">
              <MoreLink href="/discover" active={nav === "discover"}>Find Lights</MoreLink>
              <MoreLink href="/led-products" active={nav === "catalog"}>LED products</MoreLink>
              <MoreLink href="/backups" active={nav === "backups"}>Backups</MoreLink>
              <MoreLink href="/sync" active={nav === "sync"}>Sync</MoreLink>
              <MoreLink href="/settings" active={nav === "settings"}>Settings</MoreLink>
            </div>
          </details>
        </nav>
        <div className="ml-auto"><ShortcutOverlay /></div>
        <div className="hidden lg:block">
          <AllOffControl size="bar" lights={lights} sessions={sessions} />
        </div>
      </header>}

      <main className={cn("flex min-h-0 flex-1 flex-col", immersive ? "pb-0" : "pb-[var(--phone-chrome)] lg:pb-0")}>{children}</main>

      {immersive ? null : <PhoneChrome nav={nav} lights={lights} sessions={sessions} />}
    </div>
    </DiscoveryProvider>
  );
}

function Brand({ markClassName }: { markClassName: string }) {
  return (
    <Link href="/" className="flex min-h-11 items-center gap-2.5 text-inherit">
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

function MoreLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("rounded-md px-3 py-2 text-[14px]", active ? "bg-secondary font-medium" : "hover:bg-secondary/60")}
    >
      {children}
    </Link>
  );
}
