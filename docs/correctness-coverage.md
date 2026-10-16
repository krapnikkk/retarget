# Correctness coverage gate

[简体中文](zh-CN/correctness-coverage.md)

`pnpm verify` runs `pnpm test:correctness-coverage`, which executes the
`unit` and `slow` test projects once with V8 coverage. Coverage is limited to
the parser, source normalization, pose sampling, target binding, binding, and
non-humanoid solver modules whose mutations can change exported motion.

The gate is a loose global floor (75% statements, functions, and lines; 60%
branches) that catches large untested additions. It is not a per-file ratchet
and not a claim of complete correctness; refactors that remove covered code
should not fail it.

Coverage is paired with mutation guards for quaternion normalization,
coordinate signs, CUBICSPLINE value selection, and root scaling. A percentage
increase does not replace those behavior-specific tests.
