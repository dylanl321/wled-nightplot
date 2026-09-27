import { createFixtureBox } from "./wled-fixture-box.ts";

const port = Number.parseInt(process.env.NIGHTPLOT_FIXTURE_PORT ?? "48210", 10);
const hostname = "127.0.0.1";

const nativeTypeRaw = Number.parseInt(process.env.NIGHTPLOT_FIXTURE_NATIVE_TYPE ?? "", 10);
const nativeOrderRaw = Number.parseInt(process.env.NIGHTPLOT_FIXTURE_NATIVE_ORDER ?? "", 10);

const box = createFixtureBox({
  name: process.env.NIGHTPLOT_FIXTURE_NAME ?? "WLED",
  ver: process.env.NIGHTPLOT_FIXTURE_VER ?? "0.15.4",
  nativeType: Number.isSafeInteger(nativeTypeRaw) ? nativeTypeRaw : undefined,
  nativeOrder: Number.isSafeInteger(nativeOrderRaw) ? nativeOrderRaw : undefined,
  cfgEnabled: process.env.NIGHTPLOT_FIXTURE_CFG !== "0",
  mismatch: process.env.NIGHTPLOT_FIXTURE_MISMATCH === "1",
  infoNameLag: process.env.NIGHTPLOT_FIXTURE_INFO_NAME_LAG === "1",
});

const server = box.listen(port, hostname);
server.on("listening", () => {
  console.log(`wled fixture  http://${hostname}:${port}  (stub — not Hardware Done)`);
  if (box.infoNameLag) {
    console.log("info-name-lag on  /json/cfg rename will not update /json/info");
  }
});
