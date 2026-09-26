import { createServer } from "node:http";

const port = Number.parseInt(process.env.NIGHTPLOT_FIXTURE_PORT ?? "48210", 10);
const hostname = "127.0.0.1";

const info = {
  ver: "0.15.4",
  name: process.env.NIGHTPLOT_FIXTURE_NAME ?? "WLED",
  mac: "020000000001",
  brand: "WLED",
  product: "FOSS",
  leds: { count: 60, rgbw: false },
};

const state = {
  on: true,
  bri: 140,
  seg: [{ start: 0, stop: 60, col: [[255, 160, 0]] }],
};

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  res.setHeader("Content-Type", "application/json");
  if (url === "/json") {
    res.end(JSON.stringify({ info, state }));
    return;
  }
  if (url === "/json/info") {
    res.end(JSON.stringify(info));
    return;
  }
  if (url === "/json/state") {
    res.end(JSON.stringify(state));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, hostname, () => {
  console.log(`wled fixture  http://${hostname}:${port}`);
});
