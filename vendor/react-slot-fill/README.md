# React 19 compatibility fork

Based on the published react-slot-fill 2.0.1 ESM implementation by Cameron
Westland, licensed under Apache-2.0 (see LICENSE). The upstream package declares
React 16 and prop-types 16 peers and uses `contextTypes`, `getChildContext`, and
render-phase registration. React 19 removed those context APIs.

This fork keeps the package's Provider/Slot/Fill and Manager implementation.
Changes: modern context, registration after commit, prop-change handling in
componentDidUpdate, stable per-fill keys, and removal of obsolete React-internal
error introspection. The prop-types dependency is no longer needed. Type
signatures use current React types. Consumers share the Slot's context as in the
upstream composition model; put shared host providers around both Slot and Fill.

`tests/ui/slot-fill.spec.ts` checks hooks, context, StrictMode, moving
between slots and dynamic cleanup. This is a source fork, not a suppressed peer
warning or a second React installation.
