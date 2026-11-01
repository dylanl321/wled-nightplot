"use client";

import type { LightView } from "@nightplot/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AllOffControl, type LiveHint } from "@/components/all-off-control";
import { cn } from "@/lib/utils";

type ShellNav = "home" | "lights" | "discover" | "light" | "catalog" | "backups" | "sync" | "looks" | "yard" | "settings";

const MORE: { href: string; label: string; nav: ShellNav }[] = [
  { href: "/discover", label: "Find Lights", nav: "discover" },
  { href: "/led-products", label: "LED products", nav: "catalog" },
  { href: "/backups", label: "Backups", nav: "backups" },
  { href: "/sync", label: "Sync", nav: "sync" },
  { href: "/settings", label: "Settings", nav: "settings" },
];

export function PhoneChrome({
  nav,
  lights,
  sessions,
}: {
  nav: ShellNav;
  lights: LightView[];
  sessions: LiveHint[];
}) {
  const [more, setMore] = useState(false);
  const moreActive = nav === "discover" || nav === "catalog" || nav === "backups" || nav === "sync" || nav === "settings";

  useEffect(() => {
    if (!more) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMore(false);
    }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [more]);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 box-border w-full max-w-full overflow-x-clip border-t border-border bg-rail lg:hidden"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <div className="px-3 pt-2">
        <AllOffControl size="thumb" lights={lights} sessions={sessions} />
      </div>
      <nav aria-label="Nightplot" className="grid grid-cols-5 border-t border-border">
        <PhoneLink href="/" active={nav === "home"}>Yard</PhoneLink>
        <PhoneLink href="/looks" active={nav === "looks"}>Looks</PhoneLink>
        <PhoneLink href="/lights" active={nav === "lights" || nav === "light"}>Lights</PhoneLink>
        <PhoneLink href="/yard" active={nav === "yard"}>Check</PhoneLink>
        <button
          type="button"
          className={cn(
            "flex min-h-12 items-center justify-center px-1 text-[14px]",
            moreActive || more ? "font-medium text-primary" : "text-muted-foreground",
          )}
          aria-haspopup="dialog"
          aria-expanded={more}
          onClick={() => setMore(true)}
        >
          More
        </button>
      </nav>
      {more ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
          role="dialog"
          aria-modal="true"
          aria-label="More"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
            <h2 className="px-1 pb-3 text-[13px] text-muted-foreground">More</h2>
            <ul className="flex flex-col gap-2">
              {MORE.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={nav === item.nav ? "page" : undefined}
                    onClick={() => setMore(false)}
                    className={cn(
                      "flex min-h-14 items-center rounded-xl border px-4 text-[18px]",
                      nav === item.nav ? "border-primary bg-card font-medium" : "border-border bg-card",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div
            className="shrink-0 border-t border-border p-3"
            style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
          >
            <button
              type="button"
              className="min-h-14 w-full rounded-xl border border-input text-[18px] font-semibold"
              onClick={() => setMore(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PhoneLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-12 items-center justify-center px-1 text-[14px]",
        active ? "font-medium text-primary" : "text-muted-foreground",
      )}
    >
      {children}
    </Link>
  );
}
