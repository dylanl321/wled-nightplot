import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  seedLedProductsFromPresets,
  validateLedProduct,
  type LedProduct,
} from "@nightplot/shared";
import { isEnoent, keepLastGood, StoreUnreadableError } from "./store-error.ts";

type FileShape = {
  version: 1;
  products: LedProduct[];
};

/**
 * JSON catalog of operator LED products (CONFIG-52 / CONFIG-113 / CONFIG-118).
 *
 * Mirrors FileLightsStore: atomic write, versioned file, env-overridable path.
 * First boot with a missing or empty file seeds from STRIP_PRESETS so the
 * catalog is not vacant. list / create / update / remove. Does not write WLED.
 */
export class FileLedProductsStore {
  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  snapshotForBackup(): LedProduct[] {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as FileShape;
      if (parsed.version !== 1 || !this.validBackup(parsed.products))
        throw new Error("Invalid LED products store; backup refused.");
      return parsed.products;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
        return this.list(); // First boot seeds the catalog as usual.
      throw error;
    }
  }

  restoreBackup(products: LedProduct[]): void {
    if (!this.validBackup(products)) {
      throw new Error("Invalid backup LED products; nothing was restored.");
    }
    this.write(products);
  }

  validBackup(products: LedProduct[]): boolean {
    return Array.isArray(products) && products.every(isStoredProduct) &&
      new Set(products.map((product) => product.id)).size === products.length;
  }

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

  update(product: LedProduct): LedProduct | undefined {
    const products = this.read();
    if (!products.some((row) => row.id === product.id)) return undefined;
    this.write(products.map((row) => (row.id === product.id ? product : row)));
    return product;
  }

  remove(id: string): LedProduct | undefined {
    const products = this.read();
    const found = products.find((row) => row.id === id);
    if (!found) return undefined;
    this.write(products.filter((row) => row.id !== id));
    return found;
  }

  /**
   * Missing or valid-but-empty seeds the catalog. A corrupt file, or one with
   * rows that fail validation, throws: seeding over it would erase recipes.
   */
  private read(): LedProduct[] {
    let parsed: FileShape;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as FileShape;
    } catch (error) {
      if (isEnoent(error)) return this.seedIfEmpty([]);
      throw new StoreUnreadableError("LED products store", this.filePath, error instanceof SyntaxError ? "not JSON" : "unreadable");
    }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.products))
      throw new StoreUnreadableError("LED products store", this.filePath, "unexpected shape or version");
    const products = parsed.products.filter(isStoredProduct);
    if (products.length !== parsed.products.length)
      throw new StoreUnreadableError("LED products store", this.filePath,
        `${parsed.products.length - products.length} products Nightplot does not understand`);
    return this.seedIfEmpty(products);
  }

  private seedIfEmpty(products: LedProduct[]): LedProduct[] {
    if (products.length > 0) return products;
    const seeded = seedLedProductsFromPresets();
    this.write(seeded);
    return seeded;
  }

  private write(products: LedProduct[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    keepLastGood(this.filePath);
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
