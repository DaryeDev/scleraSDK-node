import MutableResource from "./MutableResource.js";
import { requireResourceId, parseResourceCtorArg } from "./resourceId.js";

const VALID_TYPES = ["string", "number", "boolean", "object", "array"];

export default class EventPayloadVariable extends MutableResource {
  #id;
  #name;
  #description;
  #type = "string";
  #defaultValue;
  #outputSchema;

  /**
   * @param {string | object} arg  Variable id, or options object with required `id`.
   */
  constructor(arg) {
    super();
    const { id, name, description, type, defaultValue, outputSchema } = parseResourceCtorArg(arg);
    this.#id = requireResourceId(id, "EventPayloadVariable");
    if (name) this.setName(name, { sync: false });
    if (description !== undefined) this.setDescription(description, { sync: false });
    if (type) this.setType(type, { sync: false });
    if (defaultValue !== undefined) this.setDefaultValue(defaultValue, { sync: false });
    if (outputSchema !== undefined) this.setOutputSchema(outputSchema, { sync: false });
  }

  setName(name, opts) {
    this.#name = name;
    this._notifyChange(opts);
    return this;
  }

  setDescription(desc, opts) {
    this.#description = desc;
    this._notifyChange(opts);
    return this;
  }

  setType(type, opts) {
    if (!VALID_TYPES.includes(type)) {
      throw new Error(`EventPayloadVariable type must be one of: ${VALID_TYPES.join(", ")}`);
    }
    this.#type = type;
    this._notifyChange(opts);
    return this;
  }

  setDefaultValue(value, opts) {
    this.#defaultValue = value;
    this._notifyChange(opts);
    return this;
  }

  setOutputSchema(schema, opts) {
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
      throw new Error("EventPayloadVariable outputSchema must be an object");
    }
    this.#outputSchema = { ...schema };
    this._notifyChange(opts);
    return this;
  }

  get id() {
    return this.#id;
  }

  get outputSchema() {
    return this.#outputSchema ? { ...this.#outputSchema } : undefined;
  }

  export() {
    return {
      name: this.#name,
      ...(this.#description && { description: this.#description }),
      type: this.#type,
      ...(this.#defaultValue !== undefined && { default: this.#defaultValue }),
      ...(this.#outputSchema !== undefined && { outputSchema: this.#outputSchema }),
    };
  }
}
