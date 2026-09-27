import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  seedLedProductsFromPresets,
  validateLedProduct,
  type LedProduct,
} from "@nightplot/shared";

type FileShape = {
  version: 1;
  products: LedProduct[];
};

/**
 * JSON catalog of operator LED products (CONFIG-52).
 *
 * Mirrors FileLightsStore: atomic write, versioned file, env-overridable path.
 * First boot with a missing or empty file seeds from STRIP_PRESETS so the
 * catalog is not vacant. Does not write WLED.
 */
export class FileLedProductsStore {
  constructor(private readonly filePath: string) {}

  list(): LedProduct[] {
    return this.read();
  }

  findById(id: string): LedProduct | undefined {
    return this.read().find((product) => product.id === id);
  }

  create(product: LedProduct): LedProduct {
    const products = this.read();
    this.write([...products, product]);
    return product;
  }

  private read(): LedProduct[] {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      if (parsed.version !== 1 || !Array.isArray(parsed.products)) {
        return this.seedIfEmpty([]);
      }
      const products = parsed.products.filter(isStoredProduct);
      return this.seedIfEmpty(products);
    } catch {
      return this.seedIfEmpty([]);
    }
  }

  private seedIfEmpty(products: LedProduct[]): LedProduct[] {
    if (products.length > 0) return products;
    const seeded = seedLedProductsFromPresets();
    this.write(seeded);
    return seeded;
  }

  private write(products: LedProduct[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const body: FileShape = { version: 1, products };
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
  }
}

function isStoredProduct(value: unknown): value is LedProduct {
  if (!value || typeof value !== "object") return false;
  const issue = validateLedProduct(value as LedProduct);
  if (issue) return false;
  const row = value as LedProduct;
  return typeof row.id === "string" && row.id.length > 0;
}
