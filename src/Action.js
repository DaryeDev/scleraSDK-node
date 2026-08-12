import ActionParameter from "./ActionParameter.js";
import ActionOutput from "./ActionOutput.js";
import MutableResource from "./MutableResource.js";
import { requireResourceId, parseResourceCtorArg } from "./resourceId.js";
import { normalizeOptionalColor } from "./color.js";
import { validateActionResult } from "./outputSchemaValidate.js";

/**
 * @typedef {object} ActionExecContext
 * @property {string | null} externalId  Subdevice externalId, or null for hub-level actions.
 * @property {string | null} [targetId]  Public connection id (hub client id or hubId:externalId).
 * @property {string | null} [subdeviceId]  Alias of targetId when execution targets a subdevice.
 * @property {import('./Subdevice.js').default | null} [subdevice]  Resolved subdevice when available.
 */

/**
 * @param {unknown} raw
 * @param {ActionOutput[]} outputs
 * @param {string} actionId
 */
export function normalizeExecResult(raw, outputs, actionId) {
  if (!outputs.length) return raw;

  if (outputs.length === 1) {
    const id = outputs[0].id;
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw) && id in raw) {
      return raw;
    }
    return { [id]: raw };
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `Action "${actionId}" with multiple outputs must return an object keyed by output id`,
    );
  }
  return raw;
}

export default class Action extends MutableResource {
  #id;
  #name;
  #description;
  #color;
  #parameters = [];
  #outputs = [];
  #exec;
  /** @type {Map<ActionParameter, () => void>} */
  #parameterUnsubs = new Map();
  /** @type {Map<ActionOutput, () => void>} */
  #outputUnsubs = new Map();

  /**
   * @param {string | object} arg  Resource id, or `{ id, name?, description?, parameters?, outputs?, exec? }`.
   * @param {string} arg.id  Immutable action id (required when arg is an object).
   */
  constructor(arg) {
    super();
    const { id, name, description, parameters = [], outputs = [], exec, color } = parseResourceCtorArg(arg);
    this.#id = requireResourceId(id, "Action");
    if (name) this.setName(name, { sync: false });
    if (description !== undefined) this.setDescription(description, { sync: false });
    if (color !== undefined) this.setColor(color, { sync: false });
    if (exec) this.setExec(exec);
    for (const p of parameters) this.addParameter(p, { sync: false });
    for (const o of outputs) this.addOutput(o, { sync: false });
  }

  #bindParameter(parameter, opts) {
    if (this.#parameterUnsubs.has(parameter)) return;
    const unsub = parameter.onChange((pOpts) => this._notifyChange(pOpts ?? opts));
    this.#parameterUnsubs.set(parameter, unsub);
  }

  #unbindParameter(parameter) {
    const unsub = this.#parameterUnsubs.get(parameter);
    if (unsub) {
      unsub();
      this.#parameterUnsubs.delete(parameter);
    }
  }

  #bindOutput(output, opts) {
    if (this.#outputUnsubs.has(output)) return;
    const unsub = output.onChange((pOpts) => this._notifyChange(pOpts ?? opts));
    this.#outputUnsubs.set(output, unsub);
  }

  #unbindOutput(output) {
    const unsub = this.#outputUnsubs.get(output);
    if (unsub) {
      unsub();
      this.#outputUnsubs.delete(output);
    }
  }

  setName(name, opts) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("Action name must be a non-empty string");
    }
    this.#name = name;
    this._notifyChange(opts);
    return this;
  }

  setDescription(description, opts) {
    if (typeof description !== "string") {
      throw new Error("Action description must be a string");
    }
    this.#description = description;
    this._notifyChange(opts);
    return this;
  }

  setColor(color, opts) {
    this.#color = normalizeOptionalColor(color);
    this._notifyChange(opts);
    return this;
  }

  addParameter(parameter, opts) {
    if (!(parameter instanceof ActionParameter)) {
      throw new Error("parameter must be an ActionParameter instance");
    }
    this.#bindParameter(parameter, opts);
    this.#parameters.push(parameter);
    this._notifyChange(opts);
    return this;
  }

  setParameters(parameters, opts) {
    if (!Array.isArray(parameters) || parameters.some((p) => !(p instanceof ActionParameter))) {
      throw new Error("parameters must be an array of ActionParameter instances");
    }
    for (const unsub of this.#parameterUnsubs.values()) unsub();
    this.#parameterUnsubs.clear();
    for (const p of parameters) this.#bindParameter(p, opts);
    this.#parameters = parameters;
    this._notifyChange(opts);
    return this;
  }

  addOutput(output, opts) {
    if (!(output instanceof ActionOutput)) {
      throw new Error("output must be an ActionOutput instance");
    }
    this.#bindOutput(output, opts);
    this.#outputs.push(output);
    this._notifyChange(opts);
    return this;
  }

  setOutputs(outputs, opts) {
    if (!Array.isArray(outputs) || outputs.some((o) => !(o instanceof ActionOutput))) {
      throw new Error("outputs must be an array of ActionOutput instances");
    }
    for (const unsub of this.#outputUnsubs.values()) unsub();
    this.#outputUnsubs.clear();
    for (const o of outputs) this.#bindOutput(o, opts);
    this.#outputs = outputs;
    this._notifyChange(opts);
    return this;
  }

  /**
   * @param {(params: object, caller: string | undefined, context: ActionExecContext) => any} fn
   */
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

  /** @param {unknown} value */
  #isSubdeviceLike(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      typeof value.externalId === "string" &&
      typeof value.export === "function" &&
      typeof value.getActionsArray === "function"
    );
  }

  /** @param {unknown} value */
  #isInboundExecContext(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      ("subdeviceId" in value || "targetId" in value)
    );
  }

  /**
   * @param {ActionExecContext | string | import('./Subdevice.js').default | null | undefined} [targetSpec]
   * @returns {ActionExecContext}
   */
  #contextFromTargetSpec(targetSpec) {
    if (targetSpec === undefined || targetSpec === null) {
      return { externalId: null, targetId: null, subdeviceId: null, subdevice: null };
    }
    if (typeof targetSpec === "string") {
      return { externalId: targetSpec, targetId: null, subdeviceId: null, subdevice: null };
    }
    if (this.#isSubdeviceLike(targetSpec)) {
      const sd = /** @type {{ externalId: string, emitterId?: string }} */ (targetSpec);
      let targetId = null;
      try {
        targetId = sd.emitterId;
      } catch {
        /* hub not connected */
      }
      return {
        externalId: sd.externalId,
        targetId,
        subdeviceId: targetId,
        subdevice: /** @type {ActionExecContext['subdevice']} */ (targetSpec),
      };
    }
    throw new Error(
      `Action "${this.#id}": target must be an externalId string or a Subdevice instance`,
    );
  }

  /**
   * @param {object} [params]
   * @param {string} [caller]
   * @param {ActionExecContext | string | import('./Subdevice.js').default} [targetSpec]
   */
  async exec(params, caller, targetSpec) {
    if (!this.#exec) {
      throw new Error(`Action "${this.#id}" has no exec function`);
    }

    const context = this.#isInboundExecContext(targetSpec)
      ? /** @type {ActionExecContext} */ (targetSpec)
      : this.#contextFromTargetSpec(targetSpec);

    const raw = await this.#exec(params ?? {}, caller, context);
    const normalized = normalizeExecResult(raw, this.#outputs, this.#id);
    if (this.#outputs.length) {
      validateActionResult(
        normalized,
        this.#outputs.map((o) => o.export()),
      );
    }
    return normalized;
  }

  export() {
    if (!this.#name) throw new Error("Action requires a name");

    const obj = {
      id: this.#id,
      name: this.#name,
    };

    if (this.#description !== undefined) obj.description = this.#description;
    if (this.#color !== undefined) obj.color = this.#color;
    if (this.#parameters.length > 0) obj.parameters = this.#parameters.map((p) => p.export());
    if (this.#outputs.length > 0) obj.outputs = this.#outputs.map((o) => o.export());

    return obj;
  }
}
