/**
 * Generic declarative visibility condition for ActionParameter ("una acción
 * = una cosa": see docs/PLAN_MIGRACION_PLUGINS_V2.md §1.2). Evaluated by
 * consumers (the flow editor) against the current values of the *other*
 * parameters of the same action/node.
 *
 * A condition is either a leaf `{ param, op, value? }` or a combinator
 * `{ all: [condition, ...] }` / `{ any: [condition, ...] }` / `{ not: condition }`.
 */

export const VISIBLE_WHEN_VALUE_OPERATORS = Object.freeze([
  "eq",
  "neq",
  "in",
  "nin",
  "gt",
  "gte",
  "lt",
  "lte",
  "truthy",
]);

export const VISIBLE_WHEN_STRUCTURAL_OPERATORS = Object.freeze([
  "connected",
  "notConnected",
  "sourceType",
]);

export const VISIBLE_WHEN_OPERATORS = Object.freeze([
  ...VISIBLE_WHEN_VALUE_OPERATORS,
  ...VISIBLE_WHEN_STRUCTURAL_OPERATORS,
]);

const NO_VALUE_OPERATORS = new Set(["truthy", "connected", "notConnected"]);
const ARRAY_VALUE_OPERATORS = new Set(["in", "nin"]);
const COMBINATOR_KEYS = new Set(["all", "any", "not"]);
const LEAF_KEYS = new Set(["param", "op", "value"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates a visibleWhen condition tree. Throws a descriptive `Error` on
 * the first problem found.
 * @param {object} condition
 * @param {string} label  Prefix identifying the owning resource, e.g. `ActionParameter "foo"`.
 * @param {string} [path]  Dotted path used in error messages.
 */
export function assertValidVisibleWhenCondition(condition, label, path = "visibleWhen") {
  if (!isPlainObject(condition)) {
    throw new Error(`${label}: ${path} must be an object`);
  }

  const combinatorKeys = Object.keys(condition).filter((k) => COMBINATOR_KEYS.has(k));
  if (combinatorKeys.length > 1) {
    throw new Error(`${label}: ${path} must use only one of all/any/not`);
  }

  if (combinatorKeys.length === 1) {
    const [key] = combinatorKeys;
    const otherKeys = Object.keys(condition).filter((k) => k !== key);
    if (otherKeys.length > 0) {
      throw new Error(`${label}: ${path}.${key} cannot be combined with other keys`);
    }
    if (key === "not") {
      assertValidVisibleWhenCondition(condition.not, label, `${path}.not`);
      return;
    }
    const list = condition[key];
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`${label}: ${path}.${key} must be a non-empty array of conditions`);
    }
    list.forEach((item, i) => assertValidVisibleWhenCondition(item, label, `${path}.${key}[${i}]`));
    return;
  }

  const { param, op } = condition;
  if (typeof param !== "string" || param.length === 0) {
    throw new Error(`${label}: ${path}.param must be a non-empty string`);
  }
  if (!VISIBLE_WHEN_OPERATORS.includes(op)) {
    throw new Error(`${label}: ${path}.op must be one of: ${VISIBLE_WHEN_OPERATORS.join(", ")}`);
  }

  const hasValue = Object.prototype.hasOwnProperty.call(condition, "value");
  if (NO_VALUE_OPERATORS.has(op)) {
    if (hasValue) {
      throw new Error(`${label}: ${path}.value is not allowed with op "${op}"`);
    }
  } else if (ARRAY_VALUE_OPERATORS.has(op)) {
    if (!Array.isArray(condition.value) || condition.value.length === 0) {
      throw new Error(`${label}: ${path}.value must be a non-empty array for op "${op}"`);
    }
  } else if (op === "sourceType") {
    if (typeof condition.value !== "string" || condition.value.length === 0) {
      throw new Error(`${label}: ${path}.value must be a non-empty string for op "sourceType"`);
    }
  } else if (!hasValue) {
    throw new Error(`${label}: ${path}.value is required for op "${op}"`);
  }

  const extraKeys = Object.keys(condition).filter((k) => !LEAF_KEYS.has(k));
  if (extraKeys.length > 0) {
    throw new Error(`${label}: ${path} has unexpected key(s): ${extraKeys.join(", ")}`);
  }
}

/** Collects every `param` id referenced anywhere in a visibleWhen tree. */
export function collectVisibleWhenParamRefs(condition, out = new Set()) {
  if (!isPlainObject(condition)) return out;
  if (Array.isArray(condition.all)) condition.all.forEach((c) => collectVisibleWhenParamRefs(c, out));
  else if (Array.isArray(condition.any)) condition.any.forEach((c) => collectVisibleWhenParamRefs(c, out));
  else if (condition.not) collectVisibleWhenParamRefs(condition.not, out);
  else if (typeof condition.param === "string") out.add(condition.param);
  return out;
}

/**
 * Cross-checks every parameter's `visibleWhen` against the full parameter
 * id set of the action: referenced params must exist among the siblings,
 * and a parameter cannot reference itself.
 * @param {Array<{id: string, visibleWhen?: object}>} exportedParameters
 * @param {string} label
 */
export function assertValidVisibleWhenReferences(exportedParameters, label) {
  const ids = new Set(exportedParameters.map((p) => p.id));
  for (const p of exportedParameters) {
    if (!p.visibleWhen) continue;
    const refs = collectVisibleWhenParamRefs(p.visibleWhen);
    for (const ref of refs) {
      if (ref === p.id) {
        throw new Error(`${label}: parameter "${p.id}" visibleWhen cannot reference itself`);
      }
      if (!ids.has(ref)) {
        throw new Error(
          `${label}: parameter "${p.id}" visibleWhen references unknown parameter "${ref}"`,
        );
      }
    }
  }
}
