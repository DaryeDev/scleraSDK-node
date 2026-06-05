import MutableResource from "./MutableResource.js";
import { requireResourceId, parseResourceCtorArg } from "./resourceId.js";

const VALID_TYPES = ["string", "number", "boolean", "object", "array"];

export default class ActionParameter extends MutableResource {
  #id;
  #name;
  #description;
  #type = "string";
  #required = false;
  #defaultValue;

  /**
   * @param {string | object} arg  Parameter id, or options object with required `id`.
   */
  constructor(arg) {
    super();
    const { id, name, description, type, required, defaultValue } = parseResourceCtorArg(arg);
    this.#id = requireResourceId(id, "ActionParameter");
    if (name) this.setName(name, { sync: false });
    if (description !== undefined) this.setDescription(description, { sync: false });
    if (type) this.setType(type, { sync: false });
    if (required !== undefined) this.setRequired(required, { sync: false });
    if (defaultValue !== undefined) this.setDefaultValue(defaultValue, { sync: false });
  }

  setName(name, opts) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("ActionParameter name must be a non-empty string");
    }
    this.#name = name;
    this._notifyChange(opts);
    return this;
  }

  setDescription(description, opts) {
    if (typeof description !== "string") {
      throw new Error("ActionParameter description must be a string");
    }
    this.#description = description;
    this._notifyChange(opts);
    return this;
  }

  setType(type, opts) {
    if (!VALID_TYPES.includes(type)) {
      throw new Error(`ActionParameter type must be one of: ${VALID_TYPES.join(", ")}`);
    }
    this.#type = type;
    this._notifyChange(opts);
    return this;
  }

  setRequired(required, opts) {
    if (typeof required !== "boolean") {
      throw new Error("ActionParameter required must be a boolean");
    }
    this.#required = required;
    this._notifyChange(opts);
    return this;
  }

  setDefaultValue(defaultValue, opts) {
    this.#defaultValue = defaultValue;
    this._notifyChange(opts);
    return this;
  }

  get id() {
    return this.#id;
  }

  export() {
    if (!this.#name) throw new Error("ActionParameter requires a name");

    const obj = {
      id: this.#id,
      name: this.#name,
      type: this.#type,
    };

    if (this.#description !== undefined) obj.description = this.#description;
    if (this.#required) obj.required = true;
    if (this.#defaultValue !== undefined) obj.defaultValue = this.#defaultValue;

    return obj;
  }
}
