import { mkdtemp, readFile, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
if (process.platform !== "darwin")
  throw Error("This installed-package probe currently supports macOS.");
const root = resolve(import.meta.dirname, "../..");
const directory = await realpath(
  await mkdtemp(join(tmpdir(), "simplebench-chat-package-")),
);
const app = join(directory, "SimpleBench.app");
execFileSync("/usr/bin/ditto", [
  join(root, "src-tauri/target/release/bundle/macos/SimpleBench.app"),
  app,
]);
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
const executable = join(app, "Contents/MacOS/simplebench");
console.log(`Installed package probe: ${directory}`);
const offline = process.argv.includes("--offline");
const child = spawn(
  offline ? "/usr/bin/sandbox-exec" : executable,
  offline
    ? ["-p", "(version 1)(allow default)(deny network-outbound)", executable]
    : [],
  {
    cwd: directory,
    env: {
      HOME: process.env.HOME,
      TMPDIR: tmpdir(),
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      SIMPLEBENCH_CHAT_PROBE_DIRECTORY: directory,
      ...(offline ? { SIMPLEBENCH_CHAT_PROBE_OFFLINE: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (data) => {
    log += data;
  });
try {
  let result;
  for (let i = 0; i < 120; i++) {
    result = await readFile(join(directory, "result.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (result || child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!result)
    throw Error("Installed package did not complete the native probe.");
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  if (child.exitCode === null) child.kill();
  await writeFile(join(directory, "native.log"), log);
}
