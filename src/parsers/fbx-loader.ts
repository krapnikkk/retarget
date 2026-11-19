/**
 * The FBX parser for every SDK path: three's FBXLoader with the Euler-step
 * fix described in `./fbx/three-fbx-loader.js`. Import it from here, not from
 * `three/examples`, so motion import, avatar inspection, conversion, and
 * export reload validation read the same keys.
 */
export { FBXLoader } from "./fbx/three-fbx-loader.js";
