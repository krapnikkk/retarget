# Third-party notices

`@krapnik/retarget` depends on the following separately distributed runtime packages:

| Package | Version range | Declared license |
| --- | ---: | --- |
| `@gltf-transform/core` | ^4.3.0 | MIT |
| `@moeru/three-mmd` | ^0.1.1 | MIT |
| `gltf-transform-vrm-extensions` | ^0.1.6 | MIT |
| `three` | ^0.184.0 | MIT |

The production dependency graph reported by pnpm also contains MIT-licensed
transitive packages and `@dimforge/rapier3d-compat` 0.12.0 under Apache-2.0
through the `@types/three` peer dependency graph.

Dependency implementations are not copied into the `@krapnik/retarget` bundle; the
published JavaScript retains external package imports. Each installed
dependency remains governed by the license and notices distributed with that
dependency. This summary does not replace those authoritative license files.

## Bundled modified source

One exception is bundled: `src/parsers/fbx/three-fbx-loader.js` is a modified
copy of `examples/jsm/loaders/FBXLoader.js` from three.js 0.184.0. It changes
the import paths and fixes how rotation keys around an Euler step of 180
degrees or more are expanded. The file header lists the changes. It is
distributed under the three.js MIT License:

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
