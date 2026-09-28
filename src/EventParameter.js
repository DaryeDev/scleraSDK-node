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
  #optionsFrom;

  /**
   * @param {string | object} arg  Parameter id, or options object with required `id`.
   */
  constructor(arg) {
    super();
    const { id, name, description, type, required, defaultValue, enumValues, optionsFrom } =
      parseResourceCtorArg(arg);
    this.#id = requireResourceId(id, "EventParameter");
    if (name) this.setName(name, { sync: false });
    if (description !== undefined) this.setDescription(description, { sync: false });
    if (type) this.setType(type, { sync: false });
    if (required !== undefined) this.setRequired(required, { sync: false });
    if (defaultValue !== undefined) this.setDefaultValue(defaultValue, { sync: false });
    if (enumValues !== undefined) this.setEnumValues(enumValues, { sync: false });
    if (optionsFrom !== undefined) this.setOptionsFrom(optionsFrom, { sync: false });
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

  /**
   * Populate this (enum) parameter's dropdown from a catalog Collection
   * instead of (or in addition to) a fixed enumValues list (plan v2.3 §1.3).
   * @param {{ collection: string, value: string, label: string, filter?: object[], strict?: boolean }} optionsFrom
   * @param {object} [opts]
   */
  setOptionsFrom(optionsFrom, opts) {
    if (!optionsFrom || typeof optionsFrom !== "object" || Array.isArray(optionsFrom)) {
      throw new Error("EventParameter optionsFrom must be an object");
    }
    const { collection, value, label, filter, strict } = optionsFrom;
    if (typeof collection !== "string" || collection.length === 0) {
      throw new Error(`EventParameter "${this.#id}": optionsFrom.collection must be a non-empty string`);
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`EventParameter "${this.#id}": optionsFrom.value must be a non-empty string`);
    }
    if (typeof label !== "string" || label.length === 0) {
      throw new Error(`EventParameter "${this.#id}": optionsFrom.label must be a non-empty string`);
    }
    if (filter !== undefined && !Array.isArray(filter)) {
      throw new Error(`EventParameter "${this.#id}": optionsFrom.filter must be an array`);
    }
    this.#optionsFrom = {
      collection,
      value,
      label,
      ...(filter !== undefined && { filter }),
      ...(strict !== undefined && { strict: !!strict }),
    };
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
    const hasEnumValues = this.#enumValues && this.#enumValues.length > 0;
    if (this.#type === "enum" && !hasEnumValues && !this.#optionsFrom) {
      throw new Error(`EventParameter "${this.#id}" of type enum requires enumValues or optionsFrom`);
    }
    if (this.#optionsFrom && this.#type !== "enum") {
      throw new Error(`EventParameter "${this.#id}" has optionsFrom but is not of type enum`);
    }

    const obj = {
      name: this.#name,
      type: this.#type,
    };

    if (this.#description !== undefined) obj.description = this.#description;
    if (this.#required) obj.required = true;
    if (this.#defaultValue !== undefined) obj.default = this.#defaultValue;
    if (this.#enumValues !== undefined) obj.enumValues = this.#enumValues;
    if (this.#optionsFrom !== undefined) obj.optionsFrom = this.#optionsFrom;

    return obj;
  }
}
