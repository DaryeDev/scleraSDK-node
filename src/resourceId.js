/** @param {unknown} id @param {string} label */
export function requireResourceId(id, label = "Resource") {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`${label} id must be a non-empty string`);
  }
  return id;
}

/**
 * Normalizes constructor args: `new Foo("id")` or `new Foo({ id, ... })`.
 * @param {string | Record<string, unknown> | undefined} arg
 * @returns {Record<string, unknown>}
 */
export function parseResourceCtorArg(arg) {
  if (typeof arg === "string") return { id: arg };
  if (arg && typeof arg === "object") return arg;
  return {};
}
