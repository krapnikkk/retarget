# Parser change checklist

- [ ] Probe only a bounded byte window and use content evidence, not filenames.
- [ ] Reject truncated headers, invalid counts/offsets, non-finite numbers, and
      unsupported interpolation before allocating expanded arrays.
- [ ] Apply shared input, duration, track, frame, sample, output, and deadline limits.
- [ ] Normalize source axes, units, rest pose, aliases, time, root motion, and
      quaternion continuity exactly once before returning canonical motion.
- [ ] Resolve package paths through the safe registry; reject traversal,
      absolute URLs, duplicate collisions, and excessive ZIP expansion.
- [ ] Return a stable error code without leaking raw content or machine paths.
- [ ] Test valid, malformed, truncated, oversized, misleadingly named, and
      ecosystem-ambiguous inputs.
