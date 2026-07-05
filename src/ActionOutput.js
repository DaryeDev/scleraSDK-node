import MutableResource from "./MutableResource.js";
import { requireResourceId, parseResourceCtorArg } from "./resourceId.js";

const VALID_TYPES = ["string", "number", "boolean", "object", "array"];

export default class ActionOutput extends MutableResource {
  #id;
  #name;
  #description;
  #type = "string";
  #schema;
  #items;

  /**
   * @param {string | object} arg  Output id, or options object with required `id`.
   */
  constructor(arg) {
    super();
    const { id, name, description, type, schema, items } = parseResourceCtorArg(arg);
    this.#id = requireResourceId(id, "ActionOutput");
    if (name) this.setName(name, { sync: false });
    if (description !== undefined) this.setDescription(description, { sync: false });
    if (type) this.setType(type, { sync: false });
    if (schema !== undefined) this.setSchema(schema, { sync: false });
    if (items !== undefined) this.setItems(items, { sync: false });
  }

  setName(name, opts) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("ActionOutput name must be a non-empty string");
    }
    this.#name = name;
    this._notifyChange(opts);
    return this;
  }

  setDescription(description, opts) {
    if (typeof description !== "string") {
      throw new Error("ActionOutput description must be a string");
    }
    this.#description = description;
    this._notifyChange(opts);
    return this;
  }

  setType(type, opts) {
    if (!VALID_TYPES.includes(type)) {
      throw new Error(`ActionOutput type must be one of: ${VALID_TYPES.join(", ")}`);
    }
    this.#type = type;
    this._notifyChange(opts);
    return this;
  }

  setSchema(schema, opts) {
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
      throw new Error("ActionOutput schema must be an object");
    }
    this.#schema = { ...schema };
    this._notifyChange(opts);
    return this;
  }

  setItems(items, opts) {
    if (typeof items !== "object" || items === null || Array.isArray(items)) {
      throw new Error("ActionOutput items must be an object");
    }
    this.#items = { ...items };
    this._notifyChange(opts);
    return this;
  }

  get id() {
    return this.#id;
  }

  export() {
    if (!this.#name) throw new Error("ActionOutput requires a name");

    const obj = {
      id: this.#id,
      name: this.#name,
      type: this.#type,
    };

    if (this.#description !== undefined) obj.description = this.#description;
    if (this.#schema !== undefined) obj.schema = this.#schema;
    if (this.#items !== undefined) obj.items = this.#items;

    return obj;
  }
}
