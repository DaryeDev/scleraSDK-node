import ActionParameter from "./ActionParameter.js";

const VALID_OUTPUT_TYPES = ["string", "number", "boolean", "object", "array"];

export default class Action {
  #id; // Las almohadillas privatizan las variables de la clase
  #name;
  #description;
  #parameters = [];
  #output;
  #exec;

  setId(id) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Action id must be a non-empty string");
    }
    this.#id = id;
    return this;
  }

  setName(name) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("Action name must be a non-empty string");
    }
    this.#name = name;
    return this;
  }

  setDescription(description) {
    if (typeof description !== "string") {
      throw new Error("Action description must be a string");
    }
    this.#description = description;
    return this;
  }

  addParameter(parameter) {
    if (!(parameter instanceof ActionParameter)) {
      throw new Error("parameter must be an ActionParameter instance");
    }
    this.#parameters.push(parameter);
    return this;
  }

  setParameters(parameters) {
    if (!Array.isArray(parameters) || parameters.some(p => !(p instanceof ActionParameter))) {
      throw new Error("parameters must be an array of ActionParameter instances");
    }
    this.#parameters = parameters;
    return this;
  }

  setOutput(output) {
    if (typeof output !== "object" || output === null || Array.isArray(output)) {
      throw new Error("output must be an object with at least a 'type' field");
    }
    if (!VALID_OUTPUT_TYPES.includes(output.type)) {
      throw new Error(`output.type must be one of: ${VALID_OUTPUT_TYPES.join(", ")}`);
    }
    this.#output = { ...output };
    return this;
  }

  setExec(fn) {
    if (typeof fn !== "function") {
      throw new Error("exec must be a function");
    }
    this.#exec = fn;
    return this;
  }

  get id() {
    return this.#id;
  }

  async exec(params, caller) {
    if (!this.#exec) {
      throw new Error(`Action "${this.#id}" has no exec function`);
    }
    return await this.#exec(params, caller);
  }

  export() {
    if (!this.#id) throw new Error("Action requires an id");
    if (!this.#name) throw new Error("Action requires a name");

    const obj = {
      id: this.#id,
      name: this.#name,
    };

    if (this.#description !== undefined) obj.description = this.#description;
    if (this.#parameters.length > 0) obj.parameters = this.#parameters.map(p => p.export());
    if (this.#output) obj.output = this.#output;

    return obj;
  }
}
