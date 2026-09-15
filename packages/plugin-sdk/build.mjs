import { build } from "tsup";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { mkdir, writeFile, cp, rm } from "node:fs/promises";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSX from "react/jsx-runtime";
const modules = {
  react: ["react", Object.keys(React)],
  "react-dom": ["reactDOM", Object.keys(ReactDOM)],
  "react-dom/client": ["reactDOMClient", Object.keys(ReactDOMClient)],
  "react/jsx-runtime": ["jsx", Object.keys(JSX)],
  "react/jsx-dev-runtime": ["jsxDev", ["Fragment", "jsxDEV"]],
  "@simplebench/plugin-sdk": ["sdk", ["HostContext", "useHostContext"]],
};
export async function buildPlugin({
  entry = "src/index.tsx",
  manifest = "plugin.json",
  assets = [],
} = {}) {
  await build({
    entry: [entry],
    format: ["esm"],
    platform: "browser",
    target: "es2022",
    splitting: true,
    clean: true,
    dts: false,
    treeshake: false,
    noExternal: Object.keys(modules),
    esbuildPlugins: [
      {
        name: "simplebench-shared-runtime",
        setup(build) {
          build.onResolve(
            { filter: /^(react(?:-dom)?(?:\/.*)?|@simplebench\/plugin-sdk)$/ },
            (args) => {
              if (!modules[args.path])
                throw new Error(`Unsupported shared entry point: ${args.path}`);
              return { path: args.path, namespace: "simplebench-shared" };
            },
          );
          build.onLoad(
            { filter: /.*/, namespace: "simplebench-shared" },
            (args) => {
              const [name, keys] = modules[args.path];
              return {
                loader: "js",
                contents: `const shared=globalThis[Symbol.for("simplebench.plugin-api.v1")]; if(!shared) throw new Error("SimpleBench host is missing"); const module=shared.${name}; export default module; ${keys
                  .filter(
                    (k) => k !== "default" && /^[a-zA-Z][a-zA-Z0-9]*$/.test(k),
                  )
                  .map((k) => `export const ${k}=module.${k};`)
                  .join("\n")}`,
              };
            },
          );
        },
      },
    ],
  });
  execFileSync(
    process.execPath,
    [
      join(
        dirname(
          createRequire(import.meta.url).resolve("typescript/package.json"),
        ),
        "bin/tsc",
      ),
      "--declaration",
      "--emitDeclarationOnly",
      "--outDir",
      "dist",
    ],
    { stdio: "inherit" },
  );
  await rm("package", { recursive: true, force: true });
  await mkdir("package", { recursive: true });
  await cp("dist", "package/dist", { recursive: true });
  await cp(manifest, "package/plugin.json");
  for (const path of assets)
    await cp(path, `package/${path}`, { recursive: true });
  await writeFile(
    "package/BUILD.txt",
    "Prebuilt SimpleBench plugin. Installation never executes package scripts.\n",
  );
}
