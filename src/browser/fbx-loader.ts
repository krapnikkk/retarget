import {LoadingManager} from "three";
import {FBXLoader} from "@/parsers/fbx-loader";

export function createMixamoFBXLoader(manager = new LoadingManager()) {
  return new FBXLoader(manager);
}
