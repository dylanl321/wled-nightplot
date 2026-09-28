import { createFixtureBox } from "./wled-fixture-box.ts";
import { listenDdp } from "./wled-ddp.ts";

const port = Number.parseInt(process.env.NIGHTPLOT_SIM_PORT ?? "48211", 10);
const ddpPort = Number.parseInt(process.env.NIGHTPLOT_SIM_DDP_PORT ?? "4048", 10);
const hostname = "127.0.0.1";

const nativeTypeRaw = Number.parseInt(process.env.NIGHTPLOT_SIM_NATIVE_TYPE ?? "", 10);
const nativeOrderRaw = Number.parseInt(process.env.NIGHTPLOT_SIM_NATIVE_ORDER ?? "", 10);

const box = createFixtureBox({
  kind: "sim",
  name: process.env.NIGHTPLOT_SIM_NAME ?? "WLED-sim",
  ver: process.env.NIGHTPLOT_SIM_VER ?? "0.15.4",
  nativeType: Number.isSafeInteger(nativeTypeRaw) ? nativeTypeRaw : undefined,
  nativeOrder: Number.isSafeInteger(nativeOrderRaw) ? nativeOrderRaw : undefined,
  cfgEnabled: process.env.NIGHTPLOT_SIM_CFG !== "0",
  mismatch: process.env.NIGHTPLOT_SIM_MISMATCH === "1",
  unknownReread: process.env.NIGHTPLOT_SIM_UNKNOWN_REREAD === "1",
  refuseState: process.env.NIGHTPLOT_SIM_REFUSE_STATE === "1",
});

const ddp = await listenDdp(ddpPort, (offset, rgb) => box.paintDdp(offset, rgb), hostname);
const server = box.listen(port, hostname);

function boundHttpPort(): number {
  const addr = server.address();
  return addr && typeof addr === "object" ? addr.port : port;
}

server.on("listening", () => {
  console.log(
    `wled sim  http://${hostname}:${boundHttpPort()}  ddp ${ddp.port}  (software path only — not Hardware Done)`,
  );
});

function shutdown() {
  server.close();
  ddp.close().finally(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
