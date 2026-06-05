/** @typedef {{ sync?: boolean, replace?: boolean }} ResourceSyncOptions */

/**
 * @param {ResourceSyncOptions | undefined} opts
 * @returns {{ sync: boolean }}
 */
export function normalizeSyncOpts(opts) {
  return { sync: opts?.sync !== false };
}

/**
 * @param {ResourceSyncOptions | undefined} opts
 * @returns {{ sync: boolean, replace: boolean }}
 */
export function normalizeRegisterOpts(opts) {
  return {
    sync: opts?.sync !== false,
    replace: opts?.replace !== false,
  };
}
