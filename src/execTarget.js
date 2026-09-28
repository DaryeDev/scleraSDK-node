/**
 * Shared vocabulary for the per-node/per-flow execution target model (the
 * Poisonete strategy: a specific connectionId, "random", "all" or "none",
 * plus an executeOnFallback and an onUnavailable policy).
 *
 * The flow graph itself is edited and stored by the node editor / Sclera
 * server (schema/flow.schema.json), not by this SDK. What a Node.js app
 * embedding this SDK needs (e.g. Kuniklo API building or reading flow JSON,
 * or a Hub replaying a flow's executeAction node with the shared execution
 * engine mentioned in the migration plan) is a single, tested place that
 * knows the special values from a literal connectionId, and can build the
 * `actionName@connectionId` ref `execAction`/`actions/exec` expect.
 *
 * See docs/PLAN_MIGRACION_PLUGINS_V2.md §5.2.
 */

/** @type {{ RANDOM: "random", ALL: "all", NONE: "none" }} */
export const EXECUTE_ON = Object.freeze({
  RANDOM: "random",
  ALL: "all",
  NONE: "none",
});

/** @type {{ SKIP: "skip", ERROR: "error" }} */
export const ON_UNAVAILABLE = Object.freeze({
  SKIP: "skip",
  ERROR: "error",
});

const SPECIAL_EXECUTE_ON_VALUES = new Set(Object.values(EXECUTE_ON));

/**
 * True when `value` is one of the special execution strategies ("random",
 * "all", "none") rather than a literal connectionId.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSpecialExecuteOn(value) {
  return typeof value === "string" && SPECIAL_EXECUTE_ON_VALUES.has(value);
}

/**
 * True when `value` is a literal connectionId (anything that isn't one of
 * the special strategies and isn't empty).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isConnectionIdTarget(value) {
  return typeof value === "string" && value.length > 0 && !isSpecialExecuteOn(value);
}

/**
 * Validates a raw `executeOn` / `executeOnFallback` value: must be a
 * non-empty string (either a special strategy or a literal connectionId).
 * @param {unknown} value
 * @param {string} label used in the error message, e.g. `"executeOn"`
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validateExecuteOn(value, label = "executeOn") {
  if (typeof value !== "string" || value.length === 0) {
    return { valid: false, error: `${label} must be a non-empty string` };
  }
  return { valid: true };
}

/**
 * Validates a raw `onUnavailable` value.
 * @param {unknown} value
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validateOnUnavailable(value) {
  const values = Object.values(ON_UNAVAILABLE);
  if (!values.includes(value)) {
    return { valid: false, error: `onUnavailable must be one of: ${values.join(", ")}` };
  }
  return { valid: true };
}

/**
 * Builds the `actionName@connectionId` ref used by `actions/exec` /
 * `ScleraClient#execAction` for a literal connectionId target. Throws for
 * "random" / "all" / "none": those strategies are resolved server-side
 * (lib/execTarget.js#findActionCandidates in the Sclera server), not by a
 * single WS `actions/exec` call, since they may fan out to zero, one, or
 * many connections.
 * @param {string} actionId
 * @param {string} connectionId literal connectionId, not a strategy value
 * @returns {string}
 */
export function buildActionRef(actionId, connectionId) {
  if (!actionId) throw new Error("buildActionRef: actionId is required");
  if (!isConnectionIdTarget(connectionId)) {
    throw new Error(
      `buildActionRef: connectionId must be a literal connection id, got ${JSON.stringify(connectionId)}. ` +
        `"random"/"all"/"none" are resolved server-side and can't be sent as a single actions/exec ref.`,
    );
  }
  return `${actionId}@${connectionId}`;
}

/**
 * Parses an `actionName@connectionId` ref (or a bare `actionName`, whose
 * connectionId is implicit: the caller's own connection).
 * @param {string} ref
 * @returns {{ actionId: string, connectionId: string | null }}
 */
export function parseActionRef(ref) {
  if (typeof ref !== "string" || !ref) {
    throw new Error("parseActionRef: ref must be a non-empty string");
  }
  const atIndex = ref.indexOf("@");
  if (atIndex === -1) return { actionId: ref, connectionId: null };
  return { actionId: ref.slice(0, atIndex), connectionId: ref.slice(atIndex + 1) };
}

/**
 * Resolves the effective executeOn/executeOnFallback/onUnavailable for an
 * executeAction flow node, applying the same precedence as the Sclera flow
 * engine (lib/nodeTypes.js#executeAction): node value, legacy
 * `connectionId` (executeOn only), flow-level default, then the Poisonete
 * defaults (random / none / skip).
 * @param {{ executeOn?: string, executeOnFallback?: string, onUnavailable?: string, connectionId?: string }} node
 * @param {{ executeOn?: string, executeOnFallback?: string, onUnavailable?: string }} [flowDefaults]
 * @returns {{ executeOn: string, executeOnFallback: string, onUnavailable: string }}
 */
export function resolveNodeExecTarget(node = {}, flowDefaults = {}) {
  return {
    executeOn: node.executeOn || node.connectionId || flowDefaults.executeOn || EXECUTE_ON.RANDOM,
    executeOnFallback:
      node.executeOnFallback ?? flowDefaults.executeOnFallback ?? EXECUTE_ON.NONE,
    onUnavailable: node.onUnavailable || flowDefaults.onUnavailable || ON_UNAVAILABLE.SKIP,
  };
}
