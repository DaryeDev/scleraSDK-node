import EventPayloadVariable from "./EventPayloadVariable.js";
import EventParameter from "./EventParameter.js";
import MutableResource from "./MutableResource.js";
import { requireResourceId, parseResourceCtorArg } from "./resourceId.js";
import { matchValuesFromPayload } from "./eventParameterMatch.js";

/** @typedef {string | null} EmitterKey  null = hub client (omit emitterId on wire) */

export default class Event extends MutableResource {
  #id;
  #name;
  #description;
  #autoAccept = true;
  #payloadVariables = [];
  #parameters = [];
  #client = null;
  /** @type {Set<EmitterKey>} */
  #registeredEmitters = new Set();
  /** @type {Map<EventPayloadVariable, () => void>} */
  #payloadVarUnsubs = new Map();
  /** @type {Map<EventParameter, () => void>} */
  #paramUnsubs = new Map();

  /**
   * @param {string | object} arg  Event id, or options object with required `id`.
   */
  constructor(arg) {
    super();
    const {
      id,
      name,
      description,
      autoAccept,
      payloadVariables = [],
      parameters = [],
    } = parseResourceCtorArg(arg);
    this.#id = requireResourceId(id, "Event");
    if (name) this.setName(name, { sync: false });
    if (description !== undefined) this.setDescription(description, { sync: false });
    if (autoAccept !== undefined) this.setAutoAccept(autoAccept, { sync: false });
    if (payloadVariables.length > 0) {
      this.setPayloadVariables(payloadVariables, { sync: false });
    }
    if (parameters.length > 0) {
      this.setParameters(parameters, { sync: false });
    }
  }

  #bindPayloadVariable(variable, opts) {
    if (this.#payloadVarUnsubs.has(variable)) return;
    const unsub = variable.onChange((pOpts) => this._notifyChange(pOpts ?? opts));
    this.#payloadVarUnsubs.set(variable, unsub);
  }

  #clearPayloadVariableBindings() {
    for (const unsub of this.#payloadVarUnsubs.values()) unsub();
    this.#payloadVarUnsubs.clear();
  }

  #bindParameter(parameter, opts) {
    if (this.#paramUnsubs.has(parameter)) return;
    const unsub = parameter.onChange((pOpts) => this._notifyChange(pOpts ?? opts));
    this.#paramUnsubs.set(parameter, unsub);
  }

  #clearParameterBindings() {
    for (const unsub of this.#paramUnsubs.values()) unsub();
    this.#paramUnsubs.clear();
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

  setAutoAccept(autoAccept, opts) {
    this.#autoAccept = autoAccept;
    this._notifyChange(opts);
    return this;
  }

  setPayloadVariables(vars, opts) {
    this.#clearPayloadVariableBindings();
    this.#payloadVariables = vars;
    for (const v of vars) {
      if (v instanceof EventPayloadVariable) this.#bindPayloadVariable(v, opts);
    }
    this._notifyChange(opts);
    return this;
  }

  addPayloadVariable(variable, opts) {
    if (variable instanceof EventPayloadVariable) {
      this.#bindPayloadVariable(variable, opts);
    }
    this.#payloadVariables.push(variable);
    this._notifyChange(opts);
    return this;
  }

  setParameters(params, opts) {
    this.#clearParameterBindings();
    this.#parameters = params;
    for (const p of params) {
      if (p instanceof EventParameter) this.#bindParameter(p, opts);
    }
    this._notifyChange(opts);
    return this;
  }

  addParameter(parameter, opts) {
    if (parameter instanceof EventParameter) {
      this.#bindParameter(parameter, opts);
    }
    this.#parameters.push(parameter);
    this._notifyChange(opts);
    return this;
  }

  get id() {
    return this.#id;
  }

  get parameters() {
    return [...this.#parameters];
  }

  /**
   * Hub catalog registration: associates the WS client and registers the hub as an emitter.
   * @param {import('./ScleraClient.js').default} client
   */
  _bindClient(client) {
    this.#client = client;
    this.#registeredEmitters.add(null);
    return this;
  }

  /**
   * @param {import('./ScleraClient.js').default} client
   * @param {{ emitterId: string }} opts  Subdevice public id (hubId:externalId).
   */
  _registerEmitter(client, { emitterId }) {
    if (!emitterId) {
      throw new Error(`Event "${this.#id}": subdevice emitterId is required`);
    }
    this.#client = client;
    this.#registeredEmitters.add(emitterId);
    return this;
  }

  /** @deprecated Use _registerEmitter */
  _bindEmitter(client, opts) {
    return this._registerEmitter(client, opts);
  }

  /**
   * @param {EmitterKey} emitterKey  Public subdevice id or null for hub.
   */
  _unregisterEmitter(emitterKey) {
    this.#registeredEmitters.delete(emitterKey);
    return this;
  }

  /** When exactly one emitter is registered, returns that id; hub → null. */
  get emitterId() {
    if (this.#registeredEmitters.size !== 1) return null;
    return [...this.#registeredEmitters][0];
  }

  /** Copy of registered emitter keys (null entries omitted). */
  get registeredEmitterIds() {
    return [...this.#registeredEmitters].filter((k) => k != null);
  }

  /**
   * @param {string | { emitterId: string }} [emitterSpec]
   * @returns {EmitterKey}
   */
  #resolveEmitter(emitterSpec) {
    let resolved;

    if (emitterSpec !== undefined && emitterSpec !== null) {
      if (typeof emitterSpec === "string") {
        resolved = emitterSpec;
      } else if (typeof emitterSpec === "object" && "emitterId" in emitterSpec) {
        resolved = emitterSpec.emitterId;
      } else {
        throw new Error(
          `Event "${this.#id}": emitter must be a public emitterId string or a bound Subdevice`,
        );
      }
    } else if (this.#registeredEmitters.size === 0) {
      throw new Error(
        `Event "${this.#id}" is not registered. Call registerEvents() or add it to a Subdevice on a connected hub.`,
      );
    } else if (this.#registeredEmitters.size === 1) {
      resolved = [...this.#registeredEmitters][0];
    } else {
      throw new Error(
        `Event "${this.#id}" is registered on multiple emitters (${[...this.#registeredEmitters].join(", ")}). Pass the emitter as the 4th argument to emit().`,
      );
    }

    if (!this.#registeredEmitters.has(resolved)) {
      throw new Error(
        `Event "${this.#id}": emitter "${resolved}" is not in the registered emitter list`,
      );
    }

    return resolved;
  }

  #emitOptions(payload, arg2, arg3, arg4) {
    // emit(payload, { match, targetListenerIds, targetUserIds, emitter })
    if (arg2 != null && typeof arg2 === "object" && !Array.isArray(arg2)) {
      const opts = arg2;
      return {
        payload,
        match: opts.match,
        targetListenerIds: opts.targetListenerIds,
        targetUserIds: opts.targetUserIds,
        emitterSpec: opts.emitter ?? opts.emitterSpec ?? arg3,
      };
    }
    // emit(payload, targetListenerIds?, targetUserIds?, emitterSpec?)
    return {
      payload,
      targetListenerIds: arg2,
      targetUserIds: arg3,
      emitterSpec: arg4,
    };
  }

  /**
   * @param {object} payload
   * @param {string[] | object} [targetListenerIdsOrOpts]
   * @param {string[]} [targetUserIds]
   * @param {string | { emitterId: string }} [emitterSpec]  Required when multiple emitters are registered.
   */
  emit(payload = {}, targetListenerIdsOrOpts = undefined, targetUserIds = undefined, emitterSpec = undefined) {
    if (!this.#client) {
      throw new Error(
        `Event "${this.#id}" is not registered. Call registerEvents() or add it to a Subdevice on a connected hub.`,
      );
    }
    const opts = this.#emitOptions(payload, targetListenerIdsOrOpts, targetUserIds, emitterSpec);
    const resolved = this.#resolveEmitter(opts.emitterSpec);

    let targetListenerIds = opts.targetListenerIds;
    let targetUserIdsOut = opts.targetUserIds;

    if (opts.match !== undefined) {
      const matched = this.#client._resolveListenersForMatch(this.#id, opts.match, {
        emitterId: resolved === null ? undefined : resolved,
      });
      targetListenerIds = matched;
      // When filtering by match, do not also broaden via targetUserIds unless explicitly set
      if (opts.targetUserIds === undefined) targetUserIdsOut = undefined;
    }

    return this.#client.emitEvent(this.#id, opts.payload, targetListenerIds, targetUserIdsOut, {
      emitterId: resolved === null ? undefined : resolved,
    });
  }

  /**
   * Emit to listeners whose subscription parameters match overlapping payload keys.
   * @param {object} payload
   * @param {string | { emitterId: string }} [emitterSpec]
   */
  emitMatching(payload = {}, emitterSpec = undefined) {
    const schema = this.export().parameterSchema;
    const match = matchValuesFromPayload(payload, schema);
    return this.emit(payload, { match, emitter: emitterSpec });
  }

  export() {
    const schema = this.#payloadVariables.length
      ? {
          type: "object",
          properties: Object.fromEntries(
            this.#payloadVariables.map((v) => [v.id, v.export()]),
          ),
        }
      : undefined;

    const parameterSchema = this.#parameters.length
      ? {
          type: "object",
          properties: Object.fromEntries(
            this.#parameters.map((p) => [p.id, p.export()]),
          ),
        }
      : undefined;

    return {
      id: this.#id,
      name: this.#name,
      ...(this.#description && { description: this.#description }),
      autoAccept: this.#autoAccept,
      ...(schema && { payloadSchema: schema }),
      ...(parameterSchema && { parameterSchema }),
    };
  }
}
