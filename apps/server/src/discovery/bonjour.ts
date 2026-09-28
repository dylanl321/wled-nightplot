import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isIPv4 } from "./interfaces.ts";
import { validPort } from "./parse.ts";
import type { Collected } from "./collect.ts";

type RunDnsSd = (args: string[], ms: number) => Promise<string>;

/** macOS's mDNSResponder can see services even when raw UDP multicast is unavailable to Node. */
export async function collectBonjour(ms: number, run: RunDnsSd = runDnsSd): Promise<Collected[]> {
  const services = parseBonjourZone(await run(["-Z", "_wled._tcp", "local"], ms)).slice(0, 16);
  const resolved = await Promise.all(services.map(async ({ target, port }) => {
    const output = await run(["-G", "v4", target], ms);
    const address = parseBonjourAddress(output, target);
    return address ? { hostname: address, port, via: "mdns" as const } : null;
  }));
  return resolved.flatMap((row) => row ? [row] : []);
}

export function parseBonjourZone(output: string): { target: string; port: number | null }[] {
  const seen = new Set<string>();
  const rows: { target: string; port: number | null }[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*\S+\._wled\._tcp\s+SRV\s+\d+\s+\d+\s+(\d+)\s+([^\s;]+\.local\.)\s*(?:;.*)?$/i);
    if (!match) continue;
    const target = match[2]!.slice(0, -1);
    if (seen.has(target.toLowerCase())) continue;
    seen.add(target.toLowerCase());
    rows.push({ target, port: validPort(match[1]) });
  }
  return rows;
}

export function parseBonjourAddress(output: string, target: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\S+\s+Add\s+\S+\s+\d+\s+(\S+)\s+(\S+)\s+\d+\s*$/);
    if (match && match[1]?.replace(/\.$/, "").toLowerCase() === target.toLowerCase() && isIPv4(match[2]!)) {
      return match[2]!;
    }
  }
  return null;
}

/** DNS-SD streams indefinitely; always stop the child at the scan deadline. No shell. */
export function runDnsSd(
  args: string[],
  ms: number,
  launch: (file: string, args: string[]) => ChildProcessWithoutNullStreams = spawn,
): Promise<string> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = launch("/usr/bin/dns-sd", args);
    } catch {
      resolve("");
      return;
    }
    let output = "";
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGTERM");
      resolve(output);
    };
    const timer = setTimeout(finish, Math.max(100, ms));
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 128_000) finish();
    });
    child.on("error", finish);
    child.on("close", finish);
  });
}
