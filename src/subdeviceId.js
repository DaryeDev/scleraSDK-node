export const SUBDEVICE_ID_SEP = ":";

export function buildSubdevicePublicId(parentId, externalId) {
  return `${parentId}${SUBDEVICE_ID_SEP}${externalId}`;
}
