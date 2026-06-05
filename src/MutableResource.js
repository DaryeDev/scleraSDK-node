import ResourceChangeNotifier from "./ResourceChangeNotifier.js";

/** @typedef {import('./syncOptions.js').ResourceSyncOptions} ResourceSyncOptions */
/** @typedef {(opts?: ResourceSyncOptions) => void} ResourceChangeListener */

/**
 * Base for SDK resources (Action, Event, Subdevice, …) that notify listeners on mutation.
 */
export default class MutableResource {
  #notifier = new ResourceChangeNotifier();

  /**
   * @param {ResourceChangeListener} listener
   * @returns {() => void} Call to remove only this listener.
   */
  onChange(listener) {
    return this.#notifier.subscribe(listener);
  }

  /**
   * @param {ResourceChangeListener} listener
   * @returns {boolean}
   */
  offChange(listener) {
    return this.#notifier.unsubscribe(listener);
  }

  /** @internal @param {ResourceSyncOptions | undefined} opts */
  _notifyChange(opts) {
    this.#notifier.notifyChange(opts);
  }
}
