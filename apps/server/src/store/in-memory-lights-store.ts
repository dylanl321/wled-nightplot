import { TextLightsStore } from "./lights-store.ts";

/**
 * A Lights store with no file. It keeps the document as JSON text, like the
 * file store, so reads return fresh objects and `undefined` keys are dropped.
 */
export class InMemoryLightsStore extends TextLightsStore {
  readonly path = undefined;
  private text: string | null;

  /** `seed` is any JSON value, stored as-is without validation, so tests can seed bad rows. */
  constructor(seed?: unknown) {
    super();
    this.text = seed === undefined ? null : JSON.stringify(seed);
  }

  protected readText(): string | null {
    return this.text;
  }

  protected writeText(text: string): void {
    this.text = text;
  }

  protected get location(): string {
    return "memory";
  }
}
