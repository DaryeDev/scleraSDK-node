import MutableResource from "./MutableResource.js";
import { requireResourceId, parseResourceCtorArg } from "./resourceId.js";

const VALID_TYPES = ["string", "number", "boolean", "enum", "array"];

export default class EventParameter extends MutableResource {
  #id;
  #name;
  #description;
  #type = "string";
  #required = false;
  #defaultValue;
  #enumValues;

  /**
   * @param {string | object} arg  Parameter id, or options object with required `id`.
   */
  constructor(arg) {
    super();
    const { id, name, description, type, required, defaultValue, enumValues } =
      parseResourceCtorArg(arg);
    this.#id = requireResourceId(id, "EventParameter");
    if (name) this.setName(name, { sync: false });
    if (description !== undefined) this.setDescription(description, { sync: false });
    if (type) this.setType(type, { sync: false });
    if (required !== undefined) this.setRequired(required, { sync: false });
    if (defaultValue !== undefined) this.setDefaultValue(defaultValue, { sync: false });
    if (enumValues !== undefined) this.setEnumValues(enumValues, { sync: false });
  }

  setName(name, opts) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("EventParameter name must be a non-empty string");
    }
    this.#name = name;
    this._notifyChange(opts);
    return this;
  }

  setDescription(description, opts) {
    if (typeof description !== "string") {
      throw new Error("EventParameter description must be a string");
    }
    this.#description = description;
    this._notifyChange(opts);
    return this;
  }

  setType(type, opts) {
    if (!VALID_TYPES.includes(type)) {
      throw new Error(`EventParameter type must be one of: ${VALID_TYPES.join(", ")}`);
    }
    this.#type = type;
    this._notifyChange(opts);
    return this;
  }

  setRequired(required, opts) {
    if (typeof required !== "boolean") {
      throw new Error("EventParameter required must be a boolean");
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

  setEnumValues(enumValues, opts) {
    if (!Array.isArray(enumValues)) {
      throw new Error("EventParameter enumValues must be an array");
    }
    this.#enumValues = enumValues;
    this._notifyChange(opts);
    return this;
  }

  get id() {
    return this.#id;
  }

  get type() {
    return this.#type;
  }

  export() {
    if (!this.#name) throw new Error("EventParameter requires a name");
    if (this.#type === "enum" && (!this.#enumValues || this.#enumValues.length === 0)) {
      throw new Error(`EventParameter "${this.#id}" of type enum requires enumValues`);
    }

    const obj = {
      name: this.#name,
      type: this.#type,
    };

    if (this.#description !== undefined) obj.description = this.#description;
    if (this.#required) obj.required = true;
    if (this.#defaultValue !== undefined) obj.default = this.#defaultValue;
    if (this.#enumValues !== undefined) obj.enumValues = this.#enumValues;

    return obj;
  }
}
