import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
/** @type {Map<string, import("ajv").ValidateFunction>} */
const compiledCache = new Map();

/**
 * @param {object} outputSchema
 */
function getValidator(outputSchema) {
  const key = JSON.stringify(outputSchema);
  if (!compiledCache.has(key)) {
    compiledCache.set(key, ajv.compile(outputSchema));
  }
  return compiledCache.get(key);
}

/**
 * @param {unknown} value
 * @param {string} type
 */
function checkDeclaredType(value, type) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    default:
      return true;
  }
}

/**
 * @param {unknown} value
 * @param {{ type?: string, outputSchema?: object }} fieldDef
 * @param {{ fieldId?: string }} [opts]
 */
export function validateFieldValue(value, fieldDef, opts = {}) {
  const fieldId = opts.fieldId ?? "value";
  if (fieldDef?.outputSchema) {
    const validate = getValidator(fieldDef.outputSchema);
    if (!validate(value)) {
      const msg =
        validate.errors?.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ") ||
        "invalid";
      throw new Error(`Field "${fieldId}" failed outputSchema validation: ${msg}`);
    }
    return;
  }
  if (fieldDef?.type && !checkDeclaredType(value, fieldDef.type)) {
    throw new Error(
      `Field "${fieldId}" expected type ${fieldDef.type}, got ${Array.isArray(value) ? "array" : typeof value}`,
    );
  }
}

/**
 * @param {object} payload
 * @param {{ properties?: Record<string, object> } | null | undefined} payloadSchema
 */
export function validateEventPayload(payload, payloadSchema) {
  if (!payloadSchema?.properties) return;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Event payload must be a plain object");
  }
  for (const [key, def] of Object.entries(payloadSchema.properties)) {
    if (!(key in payload)) continue;
    validateFieldValue(payload[key], def, { fieldId: key });
  }
}

/**
 * @param {unknown} result
 * @param {Array<{ id: string, type?: string, outputSchema?: object }>} outputs
 */
export function validateActionResult(result, outputs) {
  if (!outputs?.length) return;
  if (result === null || result === undefined) return;
  if (typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Action result must be an object keyed by output id");
  }
  for (const output of outputs) {
    const id = output.id;
    if (!(id in result)) continue;
    validateFieldValue(result[id], output, { fieldId: id });
  }
}
