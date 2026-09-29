import { serve } from "@hono/node-server";
import { dirname, join, resolve } from "node:path";
import { createCollector } from "./discovery/collect.ts";
import { createApp } from "./app.ts";
import { FileActivityStore } from "./store/activity-store.ts";
import { FileBackupStore } from "./store/backup-store.ts";
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
const activityPath = resolve(process.env.NIGHTPLOT_ACTIVITY_PATH ?? join(dirname(storePath), "activity.json"));
const backupsDir = resolve(process.env.NIGHTPLOT_BACKUPS_DIR ?? join(dirname(storePath), "backups"));
const keepAutomatic = Number.parseInt(process.env.NIGHTPLOT_BACKUP_KEEP_AUTOMATIC ?? "40", 10);
const keepSafety = Number.parseInt(process.env.NIGHTPLOT_BACKUP_KEEP_SAFETY ?? "10", 10);
const products = new FileLedProductsStore(productsPath);
const seededProducts = products.list();

const app = createApp({
  store: new FileLightsStore(storePath),
  activity: new FileActivityStore(activityPath),
  backups: new FileBackupStore(
    backupsDir,
    Number.isFinite(keepAutomatic) && keepAutomatic > 0 ? keepAutomatic : 40,
    Number.isFinite(keepSafety) && keepSafety > 0 ? keepSafety : 10,
  ),
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
  console.log(`activity  ${activityPath}`);
  console.log(`backups  ${backupsDir}`);
  console.log(`led products  ${productsPath} (${seededProducts.length})`);
});
