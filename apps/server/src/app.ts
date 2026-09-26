import {
  catalogSnapshot,
  CURRENT_SLICE,
  emptyLightsPayload,
} from "@nightplot/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: [
      "http://127.0.0.1:43180",
      "http://localhost:43180",
    ],
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "nightplot-configure",
    slice: CURRENT_SLICE,
  }),
);

app.get("/api/catalogs", (c) => c.json(catalogSnapshot()));

app.get("/api/lights", (c) => c.json(emptyLightsPayload));

function notWired(action: string) {
  return {
    error: "not_implemented",
    action,
    slice: CURRENT_SLICE,
    message: `${action} is a placeholder. Nothing was sent to hardware.`,
  };
}

app.post("/api/discover", (c) => c.json(notWired("discover"), 501));
app.post("/api/preview", (c) => c.json(notWired("preview"), 501));
app.post("/api/apply", (c) => c.json(notWired("apply"), 501));
app.post("/api/all-off", (c) => c.json(notWired("all-off"), 501));
