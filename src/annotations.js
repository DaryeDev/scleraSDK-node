/**
 * Action annotations: the same concept as `readOnlyHint` / `destructiveHint` /
 * `idempotentHint` on MCP tools. Optional, per-key — a missing key does not
 * get filled in on export ("se exportan tal cual"); consumers (editor,
 * broker, MCP bridge) apply {@link ANNOTATION_DEFAULTS} themselves when a key
 * is absent. Defaults are intentionally the conservative/dangerous case: a
 * plugin that says nothing must never be assumed safe.
 *
 * See docs/PLAN_MIGRACION_PLUGINS_V2.md §1.6.
 */

/** @type {{ readOnly: false, destructive: true, idempotent: false }} */
export const ANNOTATION_DEFAULTS = Object.freeze({
  readOnly: false,
  destructive: true,
  idempotent: false,
});

export const ANNOTATION_KEYS = Object.freeze(Object.keys(ANNOTATION_DEFAULTS));

/**
 * Validates a raw annotations object and returns a normalized copy
 * containing only the keys that were actually provided (no default-filling).
 * @param {unknown} annotations
 * @param {string} label  Used in error messages, e.g. `Action "foo"`.
 * @returns {Record<string, boolean> | undefined}
 */
export function assertValidAnnotations(annotations, label) {
  if (annotations === undefined) return undefined;
  if (annotations === null || typeof annotations !== "object" || Array.isArray(annotations)) {
    throw new Error(`${label}: annotations must be an object`);
  }
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const [key, value] of Object.entries(annotations)) {
    if (!ANNOTATION_KEYS.includes(key)) {
      throw new Error(
        `${label}: unknown annotation "${key}" (expected one of ${ANNOTATION_KEYS.join(", ")})`,
      );
    }
    if (typeof value !== "boolean") {
      throw new Error(`${label}: annotations.${key} must be a boolean`);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Merges a (possibly partial or absent) annotations object with the
 * conservative defaults, for consumers that need a fully-resolved view
 * (e.g. "is this action safe to offer as an item condition?").
 * @param {Record<string, boolean> | undefined} annotations
 * @returns {{ readOnly: boolean, destructive: boolean, idempotent: boolean }}
 */
export function resolveAnnotations(annotations) {
  return { ...ANNOTATION_DEFAULTS, ...(annotations ?? {}) };
}
