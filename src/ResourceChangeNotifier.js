/** @typedef {import('./syncOptions.js').ResourceSyncOptions} ResourceSyncOptions */

/** @typedef {(opts?: ResourceSyncOptions) => void} ResourceChangeListener */

let nextListenerId = 0;

/**
 * Multicast change notifications. Supports many subscribers; each subscription
 * returns an unsubscribe function (or use {@link offChange} with the same reference).
 */
export default class ResourceChangeNotifier {
  /** @type {Map<number, ResourceChangeListener>} */
  #listeners = new Map();

  /**
   * @param {ResourceChangeListener} listener
   * @returns {() => void} Unsubscribe this listener only.
   */
  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new Error("listener must be a function");
    }
    const id = ++nextListenerId;
    this.#listeners.set(id, listener);
    return () => {
      this.#listeners.delete(id);
    };
  }

  /**
   * @param {ResourceChangeListener} listener
   * @returns {boolean} Whether a matching listener was removed.
   */
  unsubscribe(listener) {
    for (const [id, fn] of this.#listeners) {
      if (fn === listener) {
        this.#listeners.delete(id);
        return true;
      }
    }
    return false;
  }

  clear() {
    this.#listeners.clear();
  }

  get size() {
    return this.#listeners.size;
  }

  /** @param {ResourceSyncOptions | undefined} opts */
  notifyChange(opts) {
    if (opts?.sync === false) return;
    for (const listener of this.#listeners.values()) {
      listener(opts);
    }
  }
}
