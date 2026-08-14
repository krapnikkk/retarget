# Correctness coverage gate

[简体中文](zh-CN/correctness-coverage.md)

The local pre-commit gate and immutable release preparation run
`pnpm test:correctness-coverage`. Optional hosted CI may repeat it. The gate covers
the parser, source normalization, pose sampling, target binding, and
non-humanoid solver modules whose mutations can change exported motion.

Thresholds are ratchets, not claims of complete correctness. They are pinned to
the currently demonstrated baseline and must only move upward. The long-term
branch targets remain:

| Risk surface | Current branch gate | Target |
| --- | ---: | ---: |
| Rig Motion glTF importer | 71% | 90% |
| Pose sampler | 66% | 90% |
| Source normalization | 82% | 90% |
| Target binding | 47% | 95% |
| Non-humanoid solver | 55% | 90% |

Coverage is paired with mutation guards for quaternion normalization,
coordinate signs, CUBICSPLINE value selection, and root scaling. A percentage
increase does not replace those behavior-specific tests.
