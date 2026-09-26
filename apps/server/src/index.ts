import { serve } from "@hono/node-server";
import { app } from "./app.ts";

const port = Number.parseInt(process.env.NIGHTPLOT_API_PORT ?? "43181", 10);
const hostname = process.env.NIGHTPLOT_API_HOST ?? "127.0.0.1";

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`nightplot-configure api  http://${info.address}:${info.port}`);
});
