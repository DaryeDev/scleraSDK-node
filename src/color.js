const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * @param {unknown} color
 * @returns {string}
 */
export function assertHexColor(color) {
  if (typeof color !== "string" || !HEX_COLOR_RE.test(color.trim())) {
    throw new Error("color must be #RRGGBB hex");
  }
  return color.trim().toUpperCase();
}

/**
 * @param {unknown} color
 * @returns {string | undefined}
 */
export function normalizeOptionalColor(color) {
  if (color === undefined || color === null) return undefined;
  return assertHexColor(color);
}
