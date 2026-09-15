const shared = globalThis[Symbol.for("simplebench.plugin-api.v1")];
if (!shared)
  throw new Error(
    "The SimpleBench plugin SDK must run in the main application window.",
  );
export const HostContext = shared.sdk.HostContext;
export const useHostContext = shared.sdk.useHostContext;
