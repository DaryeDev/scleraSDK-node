import MutableResource from "./MutableResource.js";
import { requireResourceId, parseResourceCtorArg } from "./resourceId.js";
import EnumValue, { isEnumPrimitive } from "./EnumValue.js";
import { assertValidVisibleWhenCondition } from "./visibleWhen.js";

const VALID_TYPES = ["string", "number", "boolean", "object", "array", "enum"];
const OPTION_TYPES = new Set(["string", "number", "boolean", "enum"]);

export function resolveActionParameterDisplay(param) {
  const type = param?.type || "string";
  return {
    showAsOption: param.showAsOption ?? (type === "enum"),
    showAsSocket: param.showAsSocket ?? (type !== "enum"),
  };
}

export default class ActionParameter extends MutableResource {
  #id;
  #name;
  #description;
  #type = "string";
  #required = false;
  #defaultValue;
  /** @type {EnumValue[] | undefined} */
  #enumValues;
  /** @type {boolean | undefined} */
  #showAsOption;
  /** @type {boolean | undefined} */
  #showAsSocket;
  /** @type {object | undefined} */
  #optionsFrom;
  /** @type {object | undefined} */
  #visibleWhen;

  /**
   * @param {string | object} arg  Parameter id, or options object with required `id`.
   */
  constructor(arg) {
    super();
    const {
      id,
      name,
      description,
      type,
      required,
      defaultValue,
      enumValues,
      showAsOption,
      showAsSocket,
      optionsFrom,
      visibleWhen,
    } = parseResourceCtorArg(arg);
    this.#id = requireResourceId(id, "ActionParameter");
    if (name) this.setName(name, { sync: false });
    if (description !== undefined) this.setDescription(description, { sync: false });
    if (type) this.setType(type, { sync: false });
    if (required !== undefined) this.setRequired(required, { sync: false });
    if (defaultValue !== undefined) this.setDefaultValue(defaultValue, { sync: false });
    if (enumValues !== undefined) this.setEnumValues(enumValues, { sync: false });
    if (showAsOption !== undefined) this.setShowAsOption(showAsOption, { sync: false });
    if (showAsSocket !== undefined) this.setShowAsSocket(showAsSocket, { sync: false });
    if (optionsFrom !== undefined) this.setOptionsFrom(optionsFrom, { sync: false });
    if (visibleWhen !== undefined) this.setVisibleWhen(visibleWhen, { sync: false });
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

  setEnumValues(enumValues, opts) {
    if (!Array.isArray(enumValues) || enumValues.length === 0) {
      throw new Error("ActionParameter enumValues must be a non-empty array");
    }
    this.#enumValues = enumValues.map((item) => EnumValue.from(item));
    this.#assertUniqueEnumValues();
    this._notifyChange(opts);
    return this;
  }

  setShowAsOption(showAsOption, opts) {
    if (typeof showAsOption !== "boolean") {
      throw new Error("ActionParameter showAsOption must be a boolean");
    }
    this.#showAsOption = showAsOption;
    this._notifyChange(opts);
    return this;
  }

  setShowAsSocket(showAsSocket, opts) {
    if (typeof showAsSocket !== "boolean") {
      throw new Error("ActionParameter showAsSocket must be a boolean");
    }
    this.#showAsSocket = showAsSocket;
    this._notifyChange(opts);
    return this;
  }

  /**
   * Populate this (enum) parameter's dropdown from a catalog Collection
   * instead of (or in addition to) a fixed enumValues list (plan v2.3
   * §1.3). Only valid when type is "enum".
   * @param {{ collection: string, value: string, label: string, filter?: object[], strict?: boolean }} optionsFrom
   * @param {object} [opts]
   */
  setOptionsFrom(optionsFrom, opts) {
    if (!optionsFrom || typeof optionsFrom !== "object" || Array.isArray(optionsFrom)) {
      throw new Error("ActionParameter optionsFrom must be an object");
    }
    const { collection, value, label, filter, strict } = optionsFrom;
    if (typeof collection !== "string" || collection.length === 0) {
      throw new Error(`ActionParameter "${this.#id}": optionsFrom.collection must be a non-empty string`);
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`ActionParameter "${this.#id}": optionsFrom.value must be a non-empty string`);
    }
    if (typeof label !== "string" || label.length === 0) {
      throw new Error(`ActionParameter "${this.#id}": optionsFrom.label must be a non-empty string`);
    }
    if (filter !== undefined && !Array.isArray(filter)) {
      throw new Error(`ActionParameter "${this.#id}": optionsFrom.filter must be an array`);
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

  /**
   * Declarative visibility condition, evaluated by the flow editor against
   * the current values of the *other* parameters of the same action.
   * Replaces the old "one action, several behaviors" mutation pattern; see
   * docs/PLAN_MIGRACION_PLUGINS_V2.md §1.2.
   * @param {object} visibleWhen  `{ param, op, value? }` or a combinator (`all`/`any`/`not`).
   * @param {object} [opts]
   */
  setVisibleWhen(visibleWhen, opts) {
    assertValidVisibleWhenCondition(visibleWhen, `ActionParameter "${this.#id}"`);
    this.#visibleWhen = visibleWhen;
    this._notifyChange(opts);
    return this;
  }

  get visibleWhen() {
    return this.#visibleWhen;
  }

  #assertUniqueEnumValues() {
    const values = this.#enumValues.map((item) => item.value);
    const seenValues = new Set();
    for (const value of values) {
      const token = `${typeof value}:${String(value)}`;
      if (seenValues.has(token)) {
        throw new Error(`ActionParameter "${this.#id}" has duplicate enum value ${JSON.stringify(value)}`);
      }
      seenValues.add(token);
    }

    const seenKeys = new Set();
    for (const item of this.#enumValues) {
      const exported = item.export();
      if (isEnumPrimitive(exported)) continue;
      if (seenKeys.has(item.key)) {
        throw new Error(`ActionParameter "${this.#id}" has duplicate enum key "${item.key}"`);
      }
      seenKeys.add(item.key);
    }
  }

  #resolvedDisplay() {
    return resolveActionParameterDisplay({
      type: this.#type,
      showAsOption: this.#showAsOption,
      showAsSocket: this.#showAsSocket,
    });
  }

  get id() {
    return this.#id;
  }

  get type() {
    return this.#type;
  }

  export() {
    if (!this.#name) throw new Error("ActionParameter requires a name");
    const hasEnumValues = this.#enumValues && this.#enumValues.length > 0;
    if (this.#type === "enum" && !hasEnumValues && !this.#optionsFrom) {
      throw new Error(`ActionParameter "${this.#id}" of type enum requires enumValues or optionsFrom`);
    }
    if (this.#optionsFrom && this.#type !== "enum") {
      throw new Error(`ActionParameter "${this.#id}" has optionsFrom but is not of type enum`);
    }

    const { showAsOption, showAsSocket } = this.#resolvedDisplay();
    if (!showAsOption && !showAsSocket) {
      throw new Error(
        `ActionParameter "${this.#id}" must have showAsOption or showAsSocket set to true`,
      );
    }
    if (showAsOption && !OPTION_TYPES.has(this.#type)) {
      throw new Error(
        `ActionParameter "${this.#id}" of type ${this.#type} cannot use showAsOption`,
      );
    }

    const obj = {
      id: this.#id,
      name: this.#name,
      type: this.#type,
      showAsOption,
      showAsSocket,
    };

    if (this.#description !== undefined) obj.description = this.#description;
    if (this.#required) obj.required = true;
    if (this.#defaultValue !== undefined) obj.defaultValue = this.#defaultValue;
    if (this.#enumValues !== undefined) {
      obj.enumValues = this.#enumValues.map((item) => item.export());
    }
    if (this.#optionsFrom !== undefined) {
      obj.optionsFrom = this.#optionsFrom;
    }
    if (this.#visibleWhen !== undefined) obj.visibleWhen = this.#visibleWhen;

    return obj;
  }
}
