const PRIMITIVE_TYPES = new Set(["string", "number", "boolean"]);

export function isEnumPrimitive(value) {
  return PRIMITIVE_TYPES.has(typeof value);
}

/**
 * A single enum choice: a primitive, or a `{ key, value }` pair.
 * `value` is sent to action exec; `key` is the dropdown label.
 */
export default class EnumValue {
  #key;
  #value;
  #primitive;

  /**
   * @param {string | number | boolean | { key: string, value: string | number | boolean }} arg
   */
  constructor(arg) {
    if (isEnumPrimitive(arg)) {
      this.#value = arg;
      this.#key = String(arg);
      this.#primitive = true;
      return;
    }

    if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
      throw new Error("EnumValue must be a string, number, boolean, or { key, value }");
    }

    if (typeof arg.key !== "string" || arg.key.length === 0) {
      throw new Error("EnumValue key must be a non-empty string");
    }
    if (!isEnumPrimitive(arg.value)) {
      throw new Error("EnumValue value must be a string, number, or boolean");
    }

    this.#key = arg.key;
    this.#value = arg.value;
    this.#primitive = false;
  }

  get key() {
    return this.#key;
  }

  get value() {
    return this.#value;
  }

  /** @param {unknown} item */
  static from(item) {
    if (item instanceof EnumValue) return item;
    return new EnumValue(item);
  }

  export() {
    if (this.#primitive) return this.#value;
    return { key: this.#key, value: this.#value };
  }
}
