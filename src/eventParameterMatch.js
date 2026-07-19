/**
 * Match listener/flow subscription parameters against emit match values.
 * Shared semantics with server lib/eventParameters.js.
 */
export function matchEventParameters(subParams, matchValues) {
  if (subParams == null || typeof subParams !== "object" || Array.isArray(subParams)) {
    return true;
  }
  const keys = Object.keys(subParams);
  if (keys.length === 0) return true;

  const match =
    matchValues && typeof matchValues === "object" && !Array.isArray(matchValues)
      ? matchValues
      : {};

  for (const key of keys) {
    const expected = subParams[key];
    if (expected === undefined || expected === null) continue;

    const actual = match[key];
    if (Array.isArray(expected)) {
      if (!expected.some((item) => jsonEqual(item, actual))) return false;
      continue;
    }
    if (!jsonEqual(expected, actual)) return false;
  }
  return true;
}

function jsonEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/** Build match object from payload keys present in parameterSchema.properties. */
export function matchValuesFromPayload(payload, parameterSchema) {
  const props = parameterSchema?.properties;
  if (!props || typeof payload !== "object" || payload == null || Array.isArray(payload)) {
    return {};
  }
  const match = {};
  for (const key of Object.keys(props)) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      match[key] = payload[key];
    }
  }
  return match;
}
