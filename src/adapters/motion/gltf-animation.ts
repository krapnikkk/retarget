import type { MotionImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";
import { importGLTFAnimation } from "@/import/gltf-animation";

export const gltfAnimationMotionAdapter = {
  id: "gltf-animation",
  label: "glTF / GLB Animation",
  profileId: "generic-gltf-humanoid",
  maturity: "active",
  probe: (file) =>
    probeImportAdapter(file, {
      container: "gltf",
      extensions: [".glb", ".gltf"],
      profile: "generic-gltf-humanoid",
      role: "motion",
    }),
  async importMotion(file) {
    return importGLTFAnimation(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
      file,
    );
  },
} satisfies MotionImportAdapter;
