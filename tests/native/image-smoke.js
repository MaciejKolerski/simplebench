(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const root = `${SMOKE_DIRECTORY}/project`;
  const wait = async (check, description) => {
    for (let i = 0; i < 200; i++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error(`Timed out: ${description}`);
  };
  try {
    const preview = () => document.querySelector(".image-canvas img");
    await wait(
      () => preview()?.complete && preview()?.naturalWidth > 0,
      "restored image",
    );
    if (document.querySelector(".cm-content"))
      throw Error("Image opened as text");
    for (const name of [
      "picture.png",
      "photo.jpg",
      "photo.webp",
      "animation.gif",
      "favicon.ico",
      "bitmap.bmp",
      "vector.svg",
      "scan.tiff",
      "pixels.ppm",
    ]) {
      const button = [...document.querySelectorAll(".file-tree button")].find(
        (button) => button.textContent.trim() === name,
      );
      if (!button) throw Error(`Explorer entry missing: ${name}`);
      button.click();
      await wait(
        () =>
          preview()?.alt === name &&
          preview()?.complete &&
          preview()?.naturalWidth > 0,
        `native decode ${name}`,
      );
    }
    const actual = [...document.querySelectorAll(".image-preview button")].find(
      (button) => button.textContent === "100%",
    );
    actual.click();
    await wait(
      () => preview()?.width === preview()?.naturalWidth,
      "actual size",
    );
    const fit = [...document.querySelectorAll(".image-preview button")].find(
      (button) => button.textContent === "Fit",
    );
    fit.click();
    await wait(() => fit.getAttribute("aria-pressed") === "true", "fit");
    for (const relative of [
      "../outside.png",
      "missing.png",
      "broken.tiff",
      "oversized.png",
    ]) {
      let denied = false;
      try {
        await invoke("read_image_file", { root, relative });
      } catch {
        denied = true;
      }
      if (!denied) throw Error(`Unsafe/invalid read accepted: ${relative}`);
    }
    await invoke("open_settings");
    await invoke("plugin_smoke_result", {
      stage: "image-settings",
      data: null,
    });
  } catch (error) {
    await invoke("plugin_smoke_result", {
      stage: "failed",
      data: String(error),
    });
  }
})();
