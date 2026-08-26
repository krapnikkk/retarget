/** Prefer joints of skins actually attached to mesh nodes over unrelated nodes
 * with the same names. Original node indices remain unchanged. */
export function skinFirstNodeIndices(json: Record<string, unknown>, nodes: readonly Record<string, unknown>[]) {
  const skins = Array.isArray(json.skins) ? json.skins as Array<{ joints?: unknown }> : [];
  const indices = new Set<number>();
  for (const node of nodes) {
    if (!Number.isInteger(node.mesh) || !Number.isInteger(node.skin)) continue;
    const joints = skins[node.skin as number]?.joints;
    if (!Array.isArray(joints)) continue;
    for (const joint of joints) if (Number.isInteger(joint) && joint >= 0 && joint < nodes.length) indices.add(joint);
  }
  for (let index = 0; index < nodes.length; index++) indices.add(index);
  return [...indices];
}
