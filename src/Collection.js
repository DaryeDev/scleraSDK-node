import MutableResource from "./MutableResource.js";

const NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;
const MAX_ITEMS = 1000;
const MAX_SERIALIZED_BYTES = 256 * 1024;

/**
 * A named, versioned list of items published ahead of time so the flow
 * editor can populate an `optionsFrom` dropdown without ever asking the
 * device while editing (plan v2.3 §1.3). Add to a Subdevice with
 * `subdevice.addCollection(collection)`.
 *
 * ```js
 * const channels = new Collection('channels', { name: 'Canales', key: 'id' });
 * subdevice.addCollection(channels);
 * channels.set(guild.channels.cache.map(c => ({ id: c.id, name: c.name, kind: kindOf(c) })));
 * bot.on('channelCreate', c => channels.upsert({ id: c.id, name: c.name, kind: kindOf(c) }));
 * bot.on('channelDelete', c => channels.remove(c.id));
 * ```
 *
 * No personal data: collections are visible to anyone editing flows for
 * this subdevice's owner. Channels/roles/rewards/scenes are fine; users,
 * emails, follower lists etc. are not (use a socket/string param instead).
 */
export default class Collection extends MutableResource {
  #name;
  #displayName;
  #itemSchema;
  #key;
  /** @type {Map<string, object>} */
  #items = new Map();
  #order = [];
  #version = 0;

  /**
   * @param {string} name  Stable collection id (referenced by optionsFrom.collection).
   * @param {object} [opts]
   * @param {string} [opts.name]  Human-readable label (e.g. "Canales"). Distinct from the id above.
   * @param {object} [opts.itemSchema]  Optional JSON Schema (draft-07) describing each item's shape.
   * @param {string} [opts.key]  Item field used as identity for upsert/remove. Defaults to "id".
   * @param {object[]} [opts.items]  Initial items.
   */
  constructor(name, opts = {}) {
    super();
    if (typeof name !== "string" || !NAME_RE.test(name)) {
      throw new Error(`Collection name must match ${NAME_RE}`);
    }
    this.#name = name;
    this.#displayName = opts.name;
    this.#itemSchema = opts.itemSchema;
    this.#key = opts.key || "id";
    if (Array.isArray(opts.items)) this.set(opts.items, { sync: false });
  }

  get id() {
    return this.#name;
  }

  get version() {
    return this.#version;
  }

  get items() {
    return [...this.#order.map((k) => this.#items.get(k))];
  }

  #keyOf(item) {
    if (item == null || typeof item !== "object") {
      throw new Error(`Collection "${this.#name}": items must be objects`);
    }
    const k = item[this.#key];
    if (k === undefined || k === null) {
      throw new Error(`Collection "${this.#name}": item is missing key field "${this.#key}"`);
    }
    return String(k);
  }

  #assertWithinLimits() {
    if (this.#order.length > MAX_ITEMS) {
      throw new Error(
        `Collection "${this.#name}" has ${this.#order.length} items, exceeds the ${MAX_ITEMS}-item soft limit`,
      );
    }
    let size = 0;
    try {
      size = Buffer.byteLength(JSON.stringify(this.items), "utf-8");
    } catch {
      // ignore; non-serializable items would already misbehave elsewhere
    }
    if (size > MAX_SERIALIZED_BYTES) {
      throw new Error(
        `Collection "${this.#name}" is ${size} bytes, exceeds the ${MAX_SERIALIZED_BYTES}-byte soft limit`,
      );
    }
  }

  #bump(opts) {
    this.#version += 1;
    this._notifyChange(opts);
  }

  /**
   * Replace the entire collection contents.
   * @param {object[]} items
   * @param {object} [opts]
   */
  set(items, opts) {
    if (!Array.isArray(items)) {
      throw new Error(`Collection "${this.#name}": items must be an array`);
    }
    const next = new Map();
    const order = [];
    for (const item of items) {
      const k = this.#keyOf(item);
      if (next.has(k)) {
        throw new Error(`Collection "${this.#name}": duplicate item key "${k}"`);
      }
      next.set(k, item);
      order.push(k);
    }
    this.#items = next;
    this.#order = order;
    this.#assertWithinLimits();
    this.#bump(opts);
    return this;
  }

  /**
   * Insert or update a single item (matched by its key field).
   * @param {object} item
   * @param {object} [opts]
   */
  upsert(item, opts) {
    const k = this.#keyOf(item);
    if (!this.#items.has(k)) this.#order.push(k);
    this.#items.set(k, item);
    this.#assertWithinLimits();
    this.#bump(opts);
    return this;
  }

  /**
   * Remove a single item by key (or by passing the item itself).
   * @param {string | number | object} keyOrItem
   * @param {object} [opts]
   */
  remove(keyOrItem, opts) {
    const k =
      keyOrItem != null && typeof keyOrItem === "object" ? this.#keyOf(keyOrItem) : String(keyOrItem);
    if (this.#items.delete(k)) {
      this.#order = this.#order.filter((existing) => existing !== k);
      this.#bump(opts);
    }
    return this;
  }

  /** Remove every item. */
  clear(opts) {
    if (this.#items.size === 0) return this;
    this.#items = new Map();
    this.#order = [];
    this.#bump(opts);
    return this;
  }

  export() {
    return {
      ...(this.#displayName !== undefined && { name: this.#displayName }),
      ...(this.#itemSchema !== undefined && { itemSchema: this.#itemSchema }),
      items: this.items,
      version: this.#version,
    };
  }
}
