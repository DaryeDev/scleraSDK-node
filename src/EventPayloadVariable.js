export default class EventPayloadVariable {
  #id;
  #name;
  #description;
  #type = 'string';
  #required = false;
  #defaultValue;

  setId(id)                  { this.#id = id; return this; }
  setName(name)              { this.#name = name; return this; }
  setDescription(desc)       { this.#description = desc; return this; }
  setType(type)              { this.#type = type; return this; }
  setRequired(required)      { this.#required = required; return this; }
  setDefaultValue(value)     { this.#defaultValue = value; return this; }

  get id() { return this.#id; }

  export() {
    return {
      name: this.#name,
      ...(this.#description && { description: this.#description }),
      type: this.#type,
      required: this.#required,
      ...(this.#defaultValue !== undefined && { default: this.#defaultValue }),
    };
  }
}
