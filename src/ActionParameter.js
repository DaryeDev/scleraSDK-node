const VALID_TYPES = ["string", "number", "boolean", "object", "array"];

export default class ActionParameter {
  #id;
  #name;
  #description;
  #type = "string";
  #required = false;
  #defaultValue;

  setId(id) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("ActionParameter id must be a non-empty string");
    }
    this.#id = id;
    return this;
  }

  setName(name) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("ActionParameter name must be a non-empty string");
    }
    this.#name = name;
    return this;
  }

  setDescription(description) {
    if (typeof description !== "string") {
      throw new Error("ActionParameter description must be a string");
    }
    this.#description = description;
    return this;
  }

  setType(type) {
    if (!VALID_TYPES.includes(type)) {
      throw new Error(`ActionParameter type must be one of: ${VALID_TYPES.join(", ")}`);
    }
    this.#type = type;
    return this;
  }

  setRequired(required) {
    if (typeof required !== "boolean") {
      throw new Error("ActionParameter required must be a boolean");
    }
    this.#required = required;
    return this;
  }

  setDefaultValue(defaultValue) {
    this.#defaultValue = defaultValue;
    return this;
  }

  export() {
    if (!this.#id) throw new Error("ActionParameter requires an id");
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
