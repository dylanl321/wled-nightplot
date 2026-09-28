import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const simEntry = fileURLToPath(new URL("./wled-sim.ts", import.meta.url));

export type SpawnedWledSim = {
  host: string;
  httpPort: number;
  ddpPort: number;
  baseUrl: string;
  child: ChildProcess;
  stop: () => Promise<void>;
};

export async function reservePort(hostname = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, hostname, () => {
      const addr = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("no port"));
      });
    });
  });
}

export async function spawnWledSim(options: {
  extraEnv?: NodeJS.ProcessEnv;
  timeoutMs?: number;
} = {}): Promise<SpawnedWledSim> {
  const httpPort = await reservePort();
  const ddpPort = await reservePort();
  const host = "127.0.0.1";
  const child = spawn(process.execPath, [tsxCli, simEntry], {
    env: {
      ...process.env,
      NIGHTPLOT_SIM_PORT: String(httpPort),
      NIGHTPLOT_SIM_DDP_PORT: String(ddpPort),
      ...options.extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (chunk) => {
    logs.push(String(chunk));
  });
  child.stderr?.on("data", (chunk) => {
    logs.push(String(chunk));
  });

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
        resolve();
      }, 1500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  try {
    await waitForHttp(`${host}:${httpPort}`, options.timeoutMs ?? 8000);
  } catch (error) {
    await stop();
    const detail = logs.join("").trim();
    throw new Error(
      `wled sim did not become ready on ${host}:${httpPort}${detail ? `\n${detail}` : ""}`,
      { cause: error },
    );
  }

  return {
    host,
    httpPort,
    ddpPort,
    baseUrl: `http://${host}:${httpPort}`,
    child,
    stop,
  };
}

async function waitForHttp(hostPort: string, timeoutMs: number) {
  const started = Date.now();
  let last: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://${hostPort}/json`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) return;
      last = res.status;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw last instanceof Error ? last : new Error(`sim HTTP not ready (${String(last)})`);
}
