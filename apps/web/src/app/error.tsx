"use client";

import { AppShell } from "@/components/app-shell";
import { ServerDown } from "@/components/server-down";

export default function ErrorView({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <AppShell lightCount={0} nav="lights">
      <ServerDown detail={error.message} />
    </AppShell>
  );
}
