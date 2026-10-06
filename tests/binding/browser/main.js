import { getRetargetPipeline, runRetargetJob } from "@krapnikkk/retarget/browser";
import { retarget } from "@krapnikkk/retarget";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AnimationMixer, Box3, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";

const status = document.querySelector("#status"), progress = document.querySelector("#progress"), report = document.querySelector("#report");
const check = (condition, message) => { if (!condition) throw new Error(message); };
const hash = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
async function rejects(run, expected) {
  try { await run(); } catch (error) { check(error.code === expected || error.name === expected, `${error.code ?? error.name}: ${error.message}`); return; }
  throw new Error(`Expected ${expected}`);
}

document.querySelector("#run").addEventListener("click", async () => {
  document.querySelector("#run").disabled = true;
  status.textContent = "Running";
  const result = { status: "running", userAgent: navigator.userAgent, secureContext: isSecureContext, checks: [] };
  const NativeWorker = window.Worker;
  const workers = [];
  window.Worker = class extends NativeWorker {
    terminated = false;
    constructor(...args) { super(...args); workers.push(this); }
    terminate() { this.terminated = true; super.terminate(); }
  };
  let ticks = 0;
  const timer = setInterval(() => { ticks++; progress.textContent = `Main-thread heartbeat: ${ticks}`; }, 8);
  try {
    const bytes = await (await fetch("/input.glb")).arrayBuffer();
    const fixture = await (await fetch("/fixture.json")).json();
    const rig = await runRetargetJob({ type: "humanoid-binding", bytes, command: { operation: "use-rig", joints: fixture.joints } });
    let solveTicks;
    const task = { type: "humanoid-binding", bytes, command: { operation: "skin", snapshot: rig, expectedRevision: rig.revision } };
    const skin = await runRetargetJob(task, { onProgress(event) { if (event.phase === "solve") solveTicks = ticks; } });
    check(solveTicks !== undefined && ticks > solveTicks, "No main-thread heartbeat during solve");
    result.checks.push("native Worker skinning keeps the main thread responsive");
    check(skin.revision === fixture.snapshotRevision, "Browser and Node snapshot revisions differ");
    const restored = JSON.parse(JSON.stringify(skin));
    const output = await runRetargetJob({ type: "humanoid-binding", bytes,
      command: { operation: "export", snapshot: restored, expectedRevision: restored.revision } });
    result.artifactSha256 = await hash(output.bytes);
    check(result.artifactSha256 === fixture.sha256, "Browser and Node GLB bytes differ");
    check(output.validation.ok && output.validation.semantic.posesCompared === 5, "Export oracle failed");
    result.checks.push("JSON restoration, Node/browser byte equality and five-pose deformation oracle");
    check(bytes.byteLength > 0, "Copy ownership detached the input");

    const controller = new AbortController(); let entered = false;
    await rejects(() => runRetargetJob(task, { signal: controller.signal, onProgress(event) {
      if (event.phase === "solve") { entered = true; controller.abort(); }
    } }), "AbortError");
    check(entered, "Cancellation did not reach a running solve");
    await rejects(() => runRetargetJob(task, { deadlineMs: 1 }), "PROCESSING_DEADLINE_EXCEEDED");
    const transferred = bytes.slice(0);
    await runRetargetJob({ type: "humanoid-binding", bytes: transferred, command: { operation: "inspect" } }, { bufferOwnership: "transfer" });
    check(transferred.byteLength === 0, "Transfer ownership did not detach input");
    result.checks.push("running cancellation, hard deadline, copy and transfer ownership");

    const large = structuredClone(skin), largeVertexCount = 100_000;
    const sourceJoints = large.weights[0].joints, sourceWeights = large.weights[0].weights;
    const sourceVertexCount = sourceJoints.length / 4;
    large.asset.primitives[0].vertexCount = largeVertexCount;
    large.weights[0].joints = Array.from({ length: largeVertexCount * 4 }, (_, i) => sourceJoints[(i % 4) + (Math.floor(i / 4) % sourceVertexCount) * 4]);
    large.weights[0].weights = Array.from({ length: largeVertexCount * 4 }, (_, i) => sourceWeights[(i % 4) + (Math.floor(i / 4) % sourceVertexCount) * 4]);
    const { revision: _oldRevision, ...largeContent } = large;
    large.revision = await hash(new TextEncoder().encode(JSON.stringify(largeContent)));
    const TrackingWorker = window.Worker;
    window.Worker = class extends TrackingWorker {
      constructor() { super(new URL("./large-snapshot.worker.js", import.meta.url), { name: "large-snapshot-echo", type: "module" }); }
    };
    let heartbeatAt = performance.now(), maxHeartbeatGapMs = 0, firstProgressAt;
    const responsivenessTimer = setInterval(() => {
      const now = performance.now(); maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - heartbeatAt); heartbeatAt = now;
    }, 8);
    await new Promise((resolve) => setTimeout(resolve, 32));
    const callStartedAt = performance.now();
    const largeTask = runRetargetJob({ type: "humanoid-binding", bytes,
      command: { operation: "skin", snapshot: large, expectedRevision: large.revision } },
    { onProgress() { firstProgressAt ??= performance.now(); } });
    const callReturnedAt = performance.now();
    const echoed = await largeTask;
    const resolvedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 32));
    clearInterval(responsivenessTimer); window.Worker = TrackingWorker;
    check(echoed.revision === large.revision, "Large snapshot response was not validated");
    check(firstProgressAt !== undefined, "Large snapshot Worker reported no progress");
    const callReturnMs = callReturnedAt - callStartedAt;
    const callToFirstProgressMs = firstProgressAt - callStartedAt;
    const progressToResolveMs = resolvedAt - firstProgressAt;
    const totalMs = resolvedAt - callStartedAt;
    check(callReturnMs < 100 && progressToResolveMs < 2_000 && maxHeartbeatGapMs < 100,
      `Large snapshot timing/responsiveness gate failed: callReturn=${callReturnMs}, callToFirstProgress=${callToFirstProgressMs}, progressToResolve=${progressToResolveMs}, total=${totalMs}, gap=${maxHeartbeatGapMs}`);
    result.largeSnapshot = { vertexCount: largeVertexCount,
      callReturnMs: Math.round(callReturnMs * 100) / 100,
      callToFirstProgressMs: Math.round(callToFirstProgressMs * 100) / 100,
      progressToResolveMs: Math.round(progressToResolveMs * 100) / 100,
      totalMs: Math.round(totalMs * 100) / 100,
      maxHeartbeatGapMs: Math.round(maxHeartbeatGapMs * 100) / 100 };
    result.checks.push("100k-vertex snapshot call/progress/resolve stages are timed and heartbeat gaps stay below 100 ms");

    const motionBytes = await (await fetch("/walk.glb")).arrayBuffer();
    const pipeline = getRetargetPipeline("gltf-animation", "gltf-humanoid", "animated-glb");
    const animated = await pipeline.run({ motionFile: new File([motionBytes], "walk.glb"),
      avatarFile: new File([output.bytes], "generated.glb"), mapping: { enabled: true, sourceProfileOverride: "auto", targetProfileOverride: "auto", chainPreset: "full-body", footCleanup: false, boneMap: {} },
      solveOptions: retarget.DEFAULT_RETARGET_SOLVE_OPTIONS });
    const validation = await runRetargetJob({ type: "validate-avatar-export", formatId: "animated-glb",
      bytes: animated.output.bytes.slice().buffer, expected: animated.solvedClip });
    check(validation.structural.ok && validation.semantic?.ok, "Retargeted animation validation failed");
    result.checks.push("generated target accepts canonical motion and exports validated animation");
    const gltf = await new GLTFLoader().parseAsync(animated.output.bytes.slice().buffer, "");
    const mixer = new AnimationMixer(gltf.scene);
    check(gltf.animations.length > 0, "GLTFLoader found no animation");
    mixer.clipAction(gltf.animations[0]).play();
    const meshes = []; gltf.scene.traverse((node) => { if (node.isSkinnedMesh) meshes.push(node); });
    check(meshes.length > 0, "GLTFLoader found no skinned mesh");
    const sample = (time) => {
      mixer.setTime(time); gltf.scene.updateMatrixWorld(true);
      for (const mesh of meshes) mesh.skeleton.update();
      return meshes.flatMap((mesh) => Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) =>
        mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld).toArray()));
    };
    const rest = sample(0), moved = sample(gltf.animations[0].duration * .5);
    check(rest.some((point, i) => point.some((v, axis) => Math.abs(v - moved[i][axis]) > 1e-5)), "Playback did not deform vertices");
    result.checks.push("Three.js import and animated vertex deformation");
    const scene = new Scene(); scene.add(gltf.scene, new HemisphereLight(0xffffff, 0x657182, 3));
    const bounds = new Box3().setFromObject(gltf.scene), centre = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3());
    const camera = new PerspectiveCamera(42, 1, .01, 100);
    camera.position.copy(centre).add(new Vector3(size.y * .7, size.y * .2, size.y * 1.9)); camera.lookAt(centre);
    const renderer = new WebGLRenderer({ antialias: true }); renderer.setSize(480, 480); renderer.setClearColor(0xe1e8ee);
    document.querySelector("#preview").replaceChildren(renderer.domElement); renderer.render(scene, camera);
    result.checks.push("WebGL preview rendered");
    check(workers.every((worker) => worker.terminated), "An isolated worker leaked");
    result.workersCreated = workers.length; result.workersTerminated = workers.filter((worker) => worker.terminated).length;
    window.Worker = undefined;
    await rejects(() => runRetargetJob(task), "WORKER_UNAVAILABLE");
    result.checks.push("all workers terminated; unavailable Worker fails closed");
    result.status = "passed"; status.textContent = "Passed";
  } catch (error) {
    result.status = "failed"; result.error = `${error.code ?? error.name}: ${error.message}`; status.textContent = "Failed";
    console.error(error);
  } finally {
    for (const worker of workers) if (!worker.terminated) worker.terminate();
    window.Worker = NativeWorker; clearInterval(timer);
    report.textContent = JSON.stringify(result, null, 2);
  }
});
