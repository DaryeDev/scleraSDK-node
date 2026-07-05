import EventPayloadVariable from "./EventPayloadVariable.js";
import MutableResource from "./MutableResource.js";
import { requireResourceId, parseResourceCtorArg } from "./resourceId.js";

/** @typedef {string | null} EmitterKey  null = hub client (omit emitterId on wire) */

export default class Event extends MutableResource {
  #id;
  #name;
  #description;
  #autoAccept = true;
  #payloadVariables = [];
  #client = null;
  /** @type {Set<EmitterKey>} */
  #registeredEmitters = new Set();
  /** @type {Map<EventPayloadVariable, () => void>} */
  #payloadVarUnsubs = new Map();

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
    } = parseResourceCtorArg(arg);
    this.#id = requireResourceId(id, "Event");
    if (name) this.setName(name, { sync: false });
    if (description !== undefined) this.setDescription(description, { sync: false });
    if (autoAccept !== undefined) this.setAutoAccept(autoAccept, { sync: false });
    if (payloadVariables.length > 0) {
      this.setPayloadVariables(payloadVariables, { sync: false });
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

  get id() {
    return this.#id;
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

  /**
   * @param {object} payload
   * @param {string[]} [targetListenerIds]
   * @param {string[]} [targetUserIds]
   * @param {string | { emitterId: string }} [emitterSpec]  Required when multiple emitters are registered.
   */
  emit(payload = {}, targetListenerIds = undefined, targetUserIds = undefined, emitterSpec = undefined) {
    if (!this.#client) {
      throw new Error(
        `Event "${this.#id}" is not registered. Call registerEvents() or add it to a Subdevice on a connected hub.`,
      );
    }
    const resolved = this.#resolveEmitter(emitterSpec);
    return this.#client.emitEvent(this.#id, payload, targetListenerIds, targetUserIds, {
      emitterId: resolved === null ? undefined : resolved,
    });
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
    return {
      id: this.#id,
      name: this.#name,
      ...(this.#description && { description: this.#description }),
      autoAccept: this.#autoAccept,
      ...(schema && { payloadSchema: schema }),
    };
  }
}
