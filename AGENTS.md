# Formationsstudio: instructions for future work

This is an independent experimental application, not an extension of the original game or Sprite Studio. Keep runtime self-contained in this directory. User-facing language is Danish.

- The authoritative simulation is formation fields. Do not give decorative soldiers movement, collision or combat authority without an explicit design change from the user.
- Keep model/terrain independent of DOM, graphics and sprite files. Rendering density and graphics visibility must not affect simulation state.
- World coordinates: x,z on ground; y is height. Heading0 faces -Z; positive angles turn toward+X. Camera pitch matches the sprite elevation (~30.05deg).
- Sprites are feet-anchored using frame pivots, meters/pixels ratio and baked owner pike masks. Do not rescale editor transforms twice. Body and pike metadata use the same local pixel space.
- Keep copies of final runtime assets in assets/. Source .blend files and exported sprite packages are inputs; never modify them when working on this studio.
- Implementations may read the former iteration for context, but must not mutate or launch its app as part of this studio's checks.
- Validate model changes with `node --test model.test.mjs`. For rendering/controller changes use the targeted browser check with the local server running; inspect screenshots when appearance changes. Avoid unsolicited benchmarking or claims of army-scale speed without measurement.
- The local server uses the Python standard library on127.0.0.1:8766. Keep normal start free of dependency downloads. No external services are needed.

Read README.md, DEVELOPMENT.md and assets/README.md for the current scope and known pike-depth approximation before extending the application.


## Relightable sprites (character v2)

- Body albedo has no baked form shadow. Normal atlas shares exactly the body atlas dimensions/UV rectangles. Keep both crops/placements coupled.
- Normals are linear RGB8 UNORM encoded as0.5*N+0.5; alpha is mesh coverage. Never gamma-correct a normal texture. PNG profiles/transfer tags must be absent; upload with UNPACK_COLORSPACE_CONVERSION_WEBGL=NONE.
- Normal axes are Blender reference-world X,Y,Z. Map to studio X,Z,Y, rotate by actor heading, then dot against the shared WORLD sun used on terrain. Camera yaw must never rotate the sun.
- Blender's threshold operates on0.5*dot+0.5, not raw dot. Preserve hard softness0 for the current ink style; antialiasing at boundaries is allowed.
- Preserve dark contour/fold pixels when shading; normal-alpha0 means ink-only coverage and must not receive form shading. Pikes currently have no body-normal flag.
- UI lighting is stored in scene.view.lighting. Older study-v1 files without lighting adopt current character defaults. Canonical azimuth is0..360 (e.g.-45 becomes315).
- Check rendering changes with lighting.test.mjs plus checks/lighting.test.cjs (known pixels) and checks/lighting-assets.cjs (real sprites), and scene/UI changes with checks/browser.test.cjs. Do not alter simulation state to apply lighting.
- tools/export_relightable.py reuses a prior raw sprite manifest for poses and framing. Disable source shading on COPIED materials and never save changes into the input .blend. Full exported pairs and validation.json are retained in a new source directory under the workspace assets tree.

## Procedural ink hatching

- Default style is `hatch`; explicit `solid` preserves filled ink shadows. Old saved lighting without a style adopts hatching. All stroke settings live in `scene.view.lighting` and normalize through lighting.mjs.
- Stroke coordinates are billboard-local meters, anchored at the feet. Do not use gl_FragCoord: camera panning must not slide the pattern over the figure.
- The normal mask and shared landscape sun remain authoritative for shadow placement. Shadow depth adds nested primary strokes at 4x/2x/1x hatchSpacing and perpendicular strokes past crossStart. Paper remains between strokes.
- Defaults: hatchSpacing .12 m, hatchWidth .018 m, hatchAngle 45 degrees, crossStart .22. A lower crossStart introduces crossing strokes earlier.
- UI/normalization allow hatchSpacing down to .005 m (step .001 m) and hatchWidth down to .0005 m (step .0005 m). Display fractional centimeters accurately; keep saved small values on load.
- Keep analytic area filtering for strokes and a one-pixel shadow-boundary filter. MSAA only covers geometry edges; it does not replace fragment-pattern antialiasing. Derivatives must be computed before discard or divergent coverage branches.
- Run checks/hatching.test.cjs for procedural coverage/AA/pan invariance and checks/hatching-preview.cjs for real-sprite appearance. Solid pixel checks explicitly select style solid. Do not rerender Blender assets merely to change the hatch pattern.

## Repository and handoff

- This directory is a separate Git repository, initially on main. Keep commits scoped to this studio; sibling Sprite Studio has its own repository. Do not initialize a parent repository or include the complete Blender working directory merely to commit studio changes.
- README.md is the Danish user guide. DEVELOPMENT.md describes the current code and modification workflow. assets/README.md is the data/export contract. Keep the relevant documents consistent when behavior or formats change.
- Runtime code, packed atlases and character metadata are tracked. Generated checks/screenshots, smoke exports, log files and Python caches are local outputs; keep them ignored. build_report.json and the small previous-runtime snapshot are intentional provenance/reference files.
- Browser checks currently refer to this development machine's existing Playwright and Chrome paths. Follow DEVELOPMENT.md to adapt them on another host. Ordinary use needs Python and WebGL2, not the development toolchain.
- Commit only when requested by the user. A commit does not imply permission to push or publish. Inspect git status and staged changes before committing; preserve unrelated user work.
