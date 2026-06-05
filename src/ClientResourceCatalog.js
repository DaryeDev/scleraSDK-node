import Action from "./Action.js";
import Event from "./Event.js";
import Subdevice from "./Subdevice.js";

function resolveId(ref) {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object") {
    return ref.id ?? ref.externalId ?? null;
  }
  return null;
}

export default class ClientResourceCatalog {
  /** @type {Map<string, Action>} */
  #actions = new Map();
  /** @type {Map<string, Event>} */
  #events = new Map();
  /** @type {Map<string, Subdevice>} */
  #subdevices = new Map();

  constructor({ actions = [], events = [], subdevices = [] } = {}) {
    for (const a of actions) this.addAction(a);
    for (const e of events) this.addEvent(e);
    for (const sd of subdevices) this.addSubdevice(sd);
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  addAction(action) {
    if (!(action instanceof Action)) {
      throw new Error("action must be an Action instance");
    }
    if (!action.id) throw new Error("Action must have an id");
    this.#actions.set(action.id, action);
    return action;
  }

  removeAction(actionOrId) {
    const id = resolveId(actionOrId);
    if (id) this.#actions.delete(id);
    return this;
  }

  getAction(id) {
    return this.#actions.get(id);
  }

  getActionsArray() {
    return [...this.#actions.values()];
  }

  // ── Events ────────────────────────────────────────────────────────────────

  addEvent(event) {
    if (!(event instanceof Event)) {
      throw new Error("event must be an Event instance");
    }
    if (!event.id) throw new Error("Event must have an id");
    this.#events.set(event.id, event);
    return event;
  }

  removeEvent(eventOrId) {
    const id = resolveId(eventOrId);
    if (id) this.#events.delete(id);
    return this;
  }

  getEvent(id) {
    return this.#events.get(id);
  }

  getEventsArray() {
    return [...this.#events.values()];
  }

  // ── Subdevices ──────────────────────────────────────────────────────────

  addSubdevice(subdevice) {
    if (!(subdevice instanceof Subdevice)) {
      throw new Error("subdevice must be a Subdevice instance");
    }
    if (!subdevice.name) throw new Error("Subdevice must have a name");
    this.#subdevices.set(subdevice.externalId, subdevice);
    return subdevice;
  }

  removeSubdevice(subdeviceOrExternalId) {
    const key =
      typeof subdeviceOrExternalId === "string"
        ? subdeviceOrExternalId
        : subdeviceOrExternalId?.externalId;
    if (key) this.#subdevices.delete(key);
    return this;
  }

  rekeySubdevice(oldExternalId, subdevice) {
    if (oldExternalId) this.#subdevices.delete(oldExternalId);
    this.#subdevices.set(subdevice.externalId, subdevice);
    return this;
  }

  getSubdevice(externalId) {
    return this.#subdevices.get(externalId);
  }

  getSubdevicesArray() {
    return [...this.#subdevices.values()];
  }

  /**
   * @param {Map<string, Map<string, Action>>} targetMap  externalId → actionId → Action
   */
  applySubdeviceActions(targetMap) {
    targetMap.clear();
    for (const sd of this.#subdevices.values()) {
      const map = new Map();
      for (const action of sd.getActionsArray()) {
        map.set(action.id, action);
      }
      targetMap.set(sd.externalId, map);
    }
  }
}
