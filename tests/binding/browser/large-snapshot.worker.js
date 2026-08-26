self.addEventListener("message", (event) => {
  const request = event.data;
  self.postMessage({ schemaVersion: request.schemaVersion, jobId: request.jobId,
    type: "progress", phase: "validate", progress: 0.5 });
  const snapshot = request.task.command.snapshot;
  const weights = snapshot.weights.map((entry) => ({ primitive: entry.primitive,
    joints: Uint16Array.from(entry.joints).buffer, weights: Float64Array.from(entry.weights).buffer }));
  const result = { transport: "humanoid-binding-snapshot-v1", snapshot: { ...snapshot, weights } };
  setTimeout(() => self.postMessage({ schemaVersion: request.schemaVersion,
    jobId: request.jobId, type: "success", result }, weights.flatMap((entry) => [entry.joints, entry.weights])), 0);
});
