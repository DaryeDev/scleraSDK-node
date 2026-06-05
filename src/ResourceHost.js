import ClientResourceCatalog from "./ClientResourceCatalog.js";

/**
 * Shared resource registry (actions, events, subdevices) for Device / ScleraClient.
 */
export default class ResourceHost {
  #catalog;

  constructor({ actions = [], events = [], subdevices = [] } = {}) {
    this.#catalog = new ClientResourceCatalog({ actions, events, subdevices });
  }

  _catalog() {
    return this.#catalog;
  }

  addAction(action) {
    this.#catalog.addAction(action);
    return this;
  }

  removeAction(actionOrId) {
    this.#catalog.removeAction(actionOrId);
    return this;
  }

  getAction(id) {
    return this.#catalog.getAction(id);
  }

  getActions() {
    return this.#catalog.getActionsArray();
  }

  addEvent(event) {
    this.#catalog.addEvent(event);
    return this;
  }

  removeEvent(eventOrId) {
    this.#catalog.removeEvent(eventOrId);
    return this;
  }

  getEvent(id) {
    return this.#catalog.getEvent(id);
  }

  getEvents() {
    return this.#catalog.getEventsArray();
  }

  addSubdevice(subdevice) {
    this.#catalog.addSubdevice(subdevice);
    return this;
  }

  removeSubdevice(subdeviceOrExternalId) {
    this.#catalog.removeSubdevice(subdeviceOrExternalId);
    return this;
  }

  getSubdevice(externalId) {
    return this.#catalog.getSubdevice(externalId);
  }

  getSubdevices() {
    return this.#catalog.getSubdevicesArray();
  }
}
