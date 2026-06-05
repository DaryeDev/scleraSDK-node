import MutableResource from "./MutableResource.js";
import { requireResourceId, parseResourceCtorArg } from "./resourceId.js";

export default class EventPayloadVariable extends MutableResource {
  #id;
  #name;
  #description;
  #type = "string";
  #defaultValue;

  /**
   * @param {string | object} arg  Variable id, or options object with required `id`.
   */
  constructor(arg) {
    super();
    const { id, name, description, type, defaultValue } = parseResourceCtorArg(arg);
    this.#id = requireResourceId(id, "EventPayloadVariable");
    if (name) this.setName(name, { sync: false });
    if (description !== undefined) this.setDescription(description, { sync: false });
    if (type) this.setType(type, { sync: false });
    if (defaultValue !== undefined) this.setDefaultValue(defaultValue, { sync: false });
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
    this.#type = type;
    this._notifyChange(opts);
    return this;
  }

  setDefaultValue(value, opts) {
    this.#defaultValue = value;
    this._notifyChange(opts);
    return this;
  }

  get id() {
    return this.#id;
  }

  export() {
    return {
      name: this.#name,
      ...(this.#description && { description: this.#description }),
      type: this.#type,
      ...(this.#defaultValue !== undefined && { default: this.#defaultValue }),
    };
  }
}
