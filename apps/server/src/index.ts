import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { createCollector } from "./discovery/collect.ts";
import { createApp } from "./app.ts";
import { FileLightsStore } from "./store/lights-store.ts";
import { createWledProbe } from "./wled/client.ts";

const port = Number.parseInt(process.env.NIGHTPLOT_API_PORT ?? "43181", 10);
const hostname = process.env.NIGHTPLOT_API_HOST ?? "127.0.0.1";
const storePath = resolve(
  process.env.NIGHTPLOT_STORE_PATH ?? "data/lights.json",
);

const app = createApp({
  store: new FileLightsStore(storePath),
  probe: createWledProbe(),
  collect: createCollector({
    targets: process.env.NIGHTPLOT_DISCOVERY_TARGETS,
  }),
});

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`nightplot-configure api  http://${info.address}:${info.port}`);
  console.log(`store  ${storePath}`);
});
