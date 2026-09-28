import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("root workspace scripts work with Corepack and no bare pnpm shim", () => {
  assert.equal(pkg.packageManager, "pnpm@10.33.3");
  for (const [name, command] of Object.entries(pkg.scripts)) {
    assert.doesNotMatch(command.replaceAll("corepack pnpm", ""), /\bpnpm\b/, `${name} needs a pnpm shim`);
  }
});
