import {VRMLoaderPlugin} from "@pixiv/three-vrm";
import {type LoadingManager} from "three";
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader.js";

export function createVRMLoader(manager?: LoadingManager) {
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader;
}
