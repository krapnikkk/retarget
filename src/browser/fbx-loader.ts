import {LoadingManager} from "three";
import {FBXLoader} from "three/examples/jsm/loaders/FBXLoader.js";

export function createMixamoFBXLoader(manager = new LoadingManager()) {
  return new FBXLoader(manager);
}
