import crypto from "crypto";
import Action from "./Action.js";
import Event from "./Event.js";
import MutableResource from "./MutableResource.js";
import { normalizeOptionalColor } from "./color.js";

const EXTERNAL_ID_RE = /^[a-zA-Z0-9._-]{1,128}$/;

export default class Subdevice extends MutableResource {
  #externalId;
  #name;
  #deviceType;
  #color;
  #metadata;
  #connected = true;
  /** @type {Map<string, Action>} */
  #actions = new Map();
  /** @type {Map<string, Event>} */
  #events = new Map();
  /** @type {{ scheduleSubdeviceSync?: (opts?: object) => void, rekeySubdevice?: (oldKey: string, sd: Subdevice) => void, getPublicId?: () => string | null, client?: import('./ScleraClient.js').default } | null} */
  #host = null;
  /** @type {(() => void) | null} */
  #hostListenerUnsub = null;
  /** @type {Map<Action, () => void>} */
  #actionListenerUnsubs = new Map();
  /** @type {Map<Event, () => void>} */
  #eventListenerUnsubs = new Map();
  /** @type {Map<Event, string>} Last registered public emitter id per event */
  #eventEmitterIds = new Map();

  /**
   * @param {object} [opts]
   * @param {string} [opts.externalId]
   * @param {string} opts.name
   * @param {string} [opts.deviceType]
   * @param {string} [opts.color]
   * @param {boolean} [opts.connected]
   * @param {object} [opts.metadata]
   * @param {Action[]} [opts.actions]
   * @param {Event[]} [opts.events]
   */
  constructor({ externalId, name, deviceType, color, connected, metadata, actions = [], events = [] } = {}) {
    super();
    if (name) this.#name = name;
    if (externalId) this.setExternalId(externalId, { sync: false });
    if (deviceType) this.#deviceType = deviceType;
    if (color !== undefined) this.setColor(color, { sync: false });
    if (connected !== undefined) this.#connected = !!connected;
    if (metadata !== undefined) this.#metadata = metadata;
    for (const action of actions) this.addAction(action, { sync: false });
    for (const event of events) this.addEvent(event, { sync: false });
  }

  /** @internal */
  _bindHost(host) {
    this.#host = host;
    this.#hostListenerUnsub?.();
    this.#hostListenerUnsub = this.onChange((opts) => host?.scheduleSubdeviceSync?.(opts));
    for (const action of this.#actions.values()) this.#bindAction(action);
    for (const event of this.#events.values()) this.#bindEvent(event);
    return this;
  }

  /** @internal */
  _unbindHost() {
    for (const event of this.#events.values()) this.#unbindEvent(event);
    this.#hostListenerUnsub?.();
    this.#hostListenerUnsub = null;
    this.#host = null;
  }

  #publicId() {
    return this.#host?.getPublicId?.() ?? null;
  }

  /**
   * Public emitter id (hubId:externalId) when bound to a connected hub.
   * @throws {Error} If the subdevice is not yet bound to a hub with a known client id.
   */
  get emitterId() {
    const id = this.#publicId();
    if (!id) {
      throw new Error(
        "Subdevice emitterId is not available until the hub is connected and the client id is known",
      );
    }
    return id;
  }

  #bindAction(action) {
    if (this.#actionListenerUnsubs.has(action)) return;
    const unsub = action.onChange((opts) => this._notifyChange(opts));
    this.#actionListenerUnsubs.set(action, unsub);
  }

  #unbindAction(action) {
    const unsub = this.#actionListenerUnsubs.get(action);
    if (unsub) {
      unsub();
      this.#actionListenerUnsubs.delete(action);
    }
  }

  #bindEvent(event) {
    if (!this.#eventListenerUnsubs.has(event)) {
      const unsub = event.onChange((opts) => this._notifyChange(opts));
      this.#eventListenerUnsubs.set(event, unsub);
    }
    const emitterId = this.#publicId();
    if (emitterId && this.#host?.client) {
      event._registerEmitter(this.#host.client, { emitterId });
      this.#eventEmitterIds.set(event, emitterId);
    }
  }

  #unbindEvent(event) {
    const unsub = this.#eventListenerUnsubs.get(event);
    if (unsub) {
      unsub();
      this.#eventListenerUnsubs.delete(event);
    }
    const emitterId = this.#eventEmitterIds.get(event);
    if (emitterId) {
      event._unregisterEmitter(emitterId);
      this.#eventEmitterIds.delete(event);
    }
  }

  /** @internal Called when hub client id is known or externalId changes. */
  _refreshEventBindings() {
    const client = this.#host?.client;
    const newId = this.#publicId();
    for (const event of this.#events.values()) {
      const oldId = this.#eventEmitterIds.get(event);
      if (oldId) {
        event._unregisterEmitter(oldId);
        this.#eventEmitterIds.delete(event);
      }
      if (newId && client) {
        event._registerEmitter(client, { emitterId: newId });
        this.#eventEmitterIds.set(event, newId);
      }
    }
  }

  setExternalId(externalId, opts) {
    if (typeof externalId !== "string" || !EXTERNAL_ID_RE.test(externalId)) {
      throw new Error(
        "externalId must be 1–128 chars: letters, digits, dot, underscore, hyphen",
      );
    }
    const prev = this.#externalId;
    this.#externalId = externalId;
    if (prev && prev !== externalId) {
      this.#host?.rekeySubdevice?.(prev, this);
    }
    this._refreshEventBindings();
    this._notifyChange(opts);
    return this;
  }

  setName(name, opts) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("Subdevice name must be a non-empty string");
    }
    this.#name = name;
    this._notifyChange(opts);
    return this;
  }

  setDeviceType(deviceType, opts) {
    this.#deviceType = deviceType;
    this._notifyChange(opts);
    return this;
  }

  setColor(color, opts) {
    this.#color = normalizeOptionalColor(color);
    this._notifyChange(opts);
    return this;
  }

  setMetadata(metadata, opts) {
    this.#metadata = metadata;
    this._notifyChange(opts);
    return this;
  }

  setConnected(connected, opts) {
    this.#connected = !!connected;
    this._notifyChange(opts);
    return this;
  }

  addAction(action, opts) {
    if (!(action instanceof Action)) {
      throw new Error("action must be an Action instance");
    }
    if (!action.id) throw new Error("Action must have an id before adding to Subdevice");
    this.#actions.set(action.id, action);
    this.#bindAction(action);
    this._notifyChange(opts);
    return this;
  }

  removeAction(actionOrId, opts) {
    const id = typeof actionOrId === "string" ? actionOrId : actionOrId?.id;
    const action = id ? this.#actions.get(id) : undefined;
    if (id) this.#actions.delete(id);
    if (action) this.#unbindAction(action);
    this._notifyChange(opts);
    return this;
  }

  addEvent(event, opts) {
    if (!(event instanceof Event)) {
      throw new Error("event must be an Event instance");
    }
    if (!event.id) throw new Error("Event must have an id before adding to Subdevice");
    this.#events.set(event.id, event);
    this.#bindEvent(event);
    this._notifyChange(opts);
    return this;
  }

  removeEvent(eventOrId, opts) {
    const id = typeof eventOrId === "string" ? eventOrId : eventOrId?.id;
    const event = id ? this.#events.get(id) : undefined;
    if (id) this.#events.delete(id);
    if (event) this.#unbindEvent(event);
    this._notifyChange(opts);
    return this;
  }

  getAction(id) {
    return this.#actions.get(id);
  }

  getEvent(id) {
    return this.#events.get(id);
  }

  get actions() {
    return this.getActionsArray();
  }

  get events() {
    return this.getEventsArray();
  }

  getActionsArray() {
    return [...this.#actions.values()];
  }

  getEventsArray() {
    return [...this.#events.values()];
  }

  get externalId() {
    if (!this.#externalId) {
      this.#externalId = `sc_${crypto.randomBytes(6).toString("hex")}`;
    }
    return this.#externalId;
  }

  get name() {
    return this.#name;
  }

  get deviceType() {
    return this.#deviceType;
  }

  get metadata() {
    return this.#metadata;
  }

  get connected() {
    return this.#connected;
  }

  toProposed() {
    if (!this.#name) throw new Error("Subdevice requires a name");
    return {
      externalId: this.externalId,
      name: this.#name,
      ...(this.#deviceType && { deviceType: this.#deviceType }),
    };
  }

  export() {
    if (!this.#name) throw new Error("Subdevice requires a name");

    return {
      externalId: this.externalId,
      name: this.#name,
      connected: this.#connected,
      ...(this.#deviceType && { deviceType: this.#deviceType }),
      ...(this.#color !== undefined && { color: this.#color }),
      ...(this.#metadata !== undefined && { metadata: this.#metadata }),
      actions: this.getActionsArray().map((a) => a.export()),
      events: this.getEventsArray().map((e) => e.export()),
    };
  }
}
