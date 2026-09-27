import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { createCollector } from "./discovery/collect.ts";
import { createApp } from "./app.ts";
import { FileLedProductsStore } from "./store/led-products-store.ts";
import { FileLightsStore } from "./store/lights-store.ts";
import { createWledCfgReader, createWledCfgWriter } from "./wled/cfg.ts";
import { createWledProbe } from "./wled/client.ts";
import { createWledLiveReader, createWledWriter } from "./wled/live.ts";

const port = Number.parseInt(process.env.NIGHTPLOT_API_PORT ?? "43181", 10);
const hostname = process.env.NIGHTPLOT_API_HOST ?? "127.0.0.1";
const storePath = resolve(
  process.env.NIGHTPLOT_STORE_PATH ?? "data/lights.json",
);
const productsPath = resolve(
  process.env.NIGHTPLOT_LED_PRODUCTS_PATH ?? "data/led-products.json",
);
const products = new FileLedProductsStore(productsPath);
const seededProducts = products.list();

const app = createApp({
  store: new FileLightsStore(storePath),
  products,
  probe: createWledProbe(),
  write: createWledWriter(),
  readLive: createWledLiveReader(),
  readCfg: createWledCfgReader(),
  writeCfg: createWledCfgWriter(),
  collect: createCollector({
    targets: process.env.NIGHTPLOT_DISCOVERY_TARGETS,
  }),
});

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`nightplot-configure api  http://${info.address}:${info.port}`);
  console.log(`store  ${storePath}`);
  console.log(`led products  ${productsPath} (${seededProducts.length})`);
});
