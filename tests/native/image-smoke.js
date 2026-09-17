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
      if (name === "vector.svg") {
        await wait(() => document.querySelector(".cm-content"), "SVG editor");
        if (preview()) throw Error("SVG did not default to code");
        const { loadedEditor } = await import("/src/editor-service.ts");
        const editor = loadedEditor({ root, relative: name });
        if (!editor) throw Error("SVG buffer missing");
        const original = editor.state.doc.toString();
        editor.view.dispatch({
          changes: {
            from: 0,
            to: editor.state.doc.length,
            insert: original.replace('width="1600"', 'width="800"'),
          },
        });
        document.querySelector('[aria-label="Preview SVG"]').click();
        await wait(() => preview()?.naturalWidth === 800, "live SVG preview");
        const toggle = document.querySelector(
          '[aria-label="Close SVG preview"]',
        );
        toggle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        await wait(
          () => document.querySelector('[role="menuitemradio"]'),
          "SVG preview options",
        );
        const previewOnly = [
          ...document.querySelectorAll('[role="menuitemradio"]'),
        ].find((button) => button.textContent.trim() === "Preview only");
        previewOnly.click();
        await wait(
          () => !document.querySelector(".cm-content"),
          "SVG preview only",
        );
        await wait(
          () => preview()?.naturalWidth === 800,
          "unsaved SVG retained",
        );
        document.querySelector('[aria-label="Close SVG preview"]').click();
        await wait(
          () => document.querySelector(".cm-content"),
          "return to SVG editor",
        );
        editor.command("undo");
        if (editor.state.doc.toString() !== original)
          throw Error("SVG undo lost");
        editor.command("redo");
        await editor.save();
        const saved = await invoke("read_editor_file", {
          root,
          relative: name,
        });
        if (!saved.content.includes('width="800"'))
          throw Error("SVG save lost edits");
      } else {
        await wait(
          () =>
            preview()?.alt === name &&
            preview()?.complete &&
            preview()?.naturalWidth > 0,
          `native decode ${name}`,
        );
      }
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
