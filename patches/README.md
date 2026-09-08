# xterm WebGL context reuse

The `@xterm/addon-webgl` 0.19.0 patch keeps one empty canvas/context available
for the next renderer. Creating a WebGL context blocks tab switching for about
200 ms on the tested Linux WebKitGTK setup. Hidden terminals still dispose their
renderers, texture atlases, GPU buffers, textures, programs, shaders, and vertex
arrays; the spare canvas has a zero-sized drawing buffer. Additional spare
contexts are explicitly released. Lost contexts and incompatible document or
context options are not reused.

The patch includes the upstream TypeScript sources and both published JavaScript
bundles. Keep them in sync when updating the dependency. The regression check is
`tests/ui/terminal-gpu.spec.ts`; `terminal-switch.spec.ts` also checks context loss,
background output, selection, and resizing.
