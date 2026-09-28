// Shared helpers for the multi-language ("i18n") catalog annex used by
// Action, Event and Subdevice. See docs-drafts/i18n-catalogs.md (server repo)
// for the wire format this mirrors.

export const MAX_I18N_LOCALES = 20;
export const MAX_I18N_BYTES = 16 * 1024;

export const LOCALE_TAG_RE = /^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function isValidLocaleTag(tag) {
  return typeof tag === "string" && LOCALE_TAG_RE.test(tag);
}

export function assertValidLocaleTag(tag, label) {
  if (!isValidLocaleTag(tag)) {
    throw new Error(`${label}: "${tag}" is not a valid locale tag (e.g. "en", "es", "pt-BR")`);
  }
}

export function assertValidDefaultLocale(locale, label) {
  if (locale === undefined || locale === null) return;
  assertValidLocaleTag(locale, `${label} defaultLocale`);
}

/**
 * Validates one locale's translation object against the ids that actually
 * exist on the resource, then returns it unchanged (for chaining).
 *
 * @param {string} locale
 * @param {object} translation
 * @param {object} opts
 * @param {string[]} opts.allowedGroups - subset of name/description/parameters/outputs/payload/enumValues
 * @param {Set<string>} [opts.parameterIds]
 * @param {Set<string>} [opts.outputIds]
 * @param {Set<string>} [opts.payloadIds]
 * @param {Set<string>} [opts.enumParameterIds]
 * @param {string} opts.label
 */
export function assertValidTranslation(locale, translation, opts) {
  const { allowedGroups, parameterIds, outputIds, payloadIds, enumParameterIds, label } = opts;
  assertValidLocaleTag(locale, `${label} i18n locale`);

  if (!translation || typeof translation !== "object" || Array.isArray(translation)) {
    throw new Error(`${label} i18n.${locale} must be an object`);
  }

  for (const key of Object.keys(translation)) {
    if (!allowedGroups.includes(key)) {
      throw new Error(`${label} i18n.${locale} has an unsupported field "${key}" (allowed: ${allowedGroups.join(", ")})`);
    }
  }

  if (translation.name !== undefined && typeof translation.name !== "string") {
    throw new Error(`${label} i18n.${locale}.name must be a string`);
  }
  if (translation.description !== undefined && typeof translation.description !== "string") {
    throw new Error(`${label} i18n.${locale}.description must be a string`);
  }

  for (const [group, allowedIds] of [
    ["parameters", parameterIds],
    ["outputs", outputIds],
    ["payload", payloadIds],
  ]) {
    if (translation[group] === undefined) continue;
    if (typeof translation[group] !== "object" || Array.isArray(translation[group])) {
      throw new Error(`${label} i18n.${locale}.${group} must be an object`);
    }
    for (const [id, value] of Object.entries(translation[group])) {
      if (allowedIds && !allowedIds.has(id)) {
        throw new Error(`${label} i18n.${locale}.${group} references unknown id "${id}"`);
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} i18n.${locale}.${group}.${id} must be an object`);
      }
      for (const k of Object.keys(value)) {
        if (k !== "name" && k !== "description") {
          throw new Error(`${label} i18n.${locale}.${group}.${id} has an unsupported field "${k}"`);
        }
      }
    }
  }

  if (translation.enumValues !== undefined) {
    if (typeof translation.enumValues !== "object" || Array.isArray(translation.enumValues)) {
      throw new Error(`${label} i18n.${locale}.enumValues must be an object`);
    }
    for (const [paramId, labels] of Object.entries(translation.enumValues)) {
      if (enumParameterIds && !enumParameterIds.has(paramId)) {
        throw new Error(`${label} i18n.${locale}.enumValues references unknown id "${paramId}"`);
      }
      if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
        throw new Error(`${label} i18n.${locale}.enumValues.${paramId} must be an object`);
      }
    }
  }

  return translation;
}

export function assertWithinLimits(i18n, label) {
  const locales = Object.keys(i18n);
  if (locales.length > MAX_I18N_LOCALES) {
    throw new Error(`${label} i18n declares ${locales.length} locales (max ${MAX_I18N_LOCALES})`);
  }
  const bytes = Buffer.byteLength(JSON.stringify(i18n), "utf-8");
  if (bytes > MAX_I18N_BYTES) {
    throw new Error(`${label} i18n is ${bytes} bytes (max ${MAX_I18N_BYTES})`);
  }
}
