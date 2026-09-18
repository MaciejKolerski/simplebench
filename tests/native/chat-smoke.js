(async () => {
  if (globalThis.__chatProbeStarted) return;
  globalThis.__chatProbeStarted = true;
  try {
    const { run } = await import("PROBE_MODULE");
    await run();
  } catch (error) {
    await window.__TAURI_INTERNALS__.invoke("chat_probe_result", {
      result: { passed: false, error: String(error) },
    });
  }
})();
