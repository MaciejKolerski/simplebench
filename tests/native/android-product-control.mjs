import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2]);
const id = process.argv[3];
if (!/^[a-zA-Z0-9-]{1,100}$/.test(id ?? ""))
  throw Error("Invalid instruction ID");
let input = "";
for await (const chunk of process.stdin) input += chunk;
const value = JSON.parse(input);
if (typeof value.script === "string") {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  // Reject malformed fixture code before leaving the native caller waiting.
  new AsyncFunction("invoke", "sleep", "wait", "click", value.script);
}
const destination = join(root, `${id}.json`);
try {
  await readFile(destination);
  throw Error("Preserve the earlier result; use a new instruction ID");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await writeFile(
  join(root, "instruction.tmp"),
  JSON.stringify({ ...value, id }),
);
await rename(join(root, "instruction.tmp"), join(root, "instruction.json"));
const deadline = Date.now() + (value.timeoutMs ?? 30000);
for (;;) {
  try {
    const report = JSON.parse(await readFile(destination, "utf8"));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    break;
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  if (Date.now() > deadline)
    throw Error(
      "Product instruction timed out; the owned app and phone remain available",
    );
  await new Promise((resolve) => setTimeout(resolve, 150));
}
